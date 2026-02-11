import * as path from 'path';
import * as fs from 'fs';
import * as core from '@actions/core';
import { StorageProvider } from '../interfaces';
import { BaseStorageProvider, BaseStorageOptions, formatBytes } from '../baseProvider';
import { LocalStorageBackend, createLocalStorageBackend } from './localBackend';
import { createFileIndexStore } from './fileIndexStore';
import { createFileLockManager } from './fileLockManager';
import { CacheEntry, findEntry, addEntry } from '../../keyResolver/indexManager';
import { createArchive, extractArchive } from '../../archive/tar';
import { CompressionOptions } from '../../archive/compression';
import { entryToManifest, writeManifest, deleteManifest } from './manifestStore';

/**
 * Options for local storage provider
 */
export interface LocalStorageOptions extends BaseStorageOptions {
  compression?: CompressionOptions;
}

/**
 * Local filesystem storage provider
 * Uses local filesystem for storing cache archives
 */
export class LocalStorageProvider extends BaseStorageProvider implements StorageProvider {
  private readonly cacheDir: string;
  private readonly localBackend: LocalStorageBackend;

  constructor(basePath: string, owner: string, repo: string, options: LocalStorageOptions = {}) {
    const cacheDir = path.join(basePath, owner, repo);
    const localBackend = createLocalStorageBackend(cacheDir);
    const indexStore = createFileIndexStore(cacheDir);
    const lockManager = createFileLockManager(cacheDir);

    super(localBackend, indexStore, lockManager, options);

    this.cacheDir = cacheDir;
    this.localBackend = localBackend;
  }

  async restore(entry: CacheEntry): Promise<void> {
    const archivePath = this.localBackend.getFullPath(entry.archivePath);

    if (!(await this.backend.exists(entry.archivePath))) {
      throw new Error(`Cache archive not found: ${archivePath}`);
    }

    core.info(`Extracting cache from ${archivePath}`);
    await extractArchive(archivePath, process.cwd());
    core.info(`Cache restored successfully`);

    // Update accessedAt for LRU tracking (best-effort)
    await this.updateAccessTimeForEntry(entry.key);
  }

  async save(key: string, paths: string[]): Promise<CacheEntry> {
    // PHASE A: Slow I/O without lock (archive creation can take minutes)
    const archivesDir = await this.localBackend.ensureArchivesDir();
    core.info(`Creating cache archive for ${paths.length} path(s)`);

    const compressionOptions = this.options.compression as CompressionOptions | undefined;
    const result = await createArchive(paths, archivesDir, undefined, compressionOptions);

    // Rename to .tmp suffix with unique identifier to prevent concurrent write collisions
    const tempArchivePath = `${result.archivePath}.tmp.${Date.now()}.${process.pid}`;
    try {
      fs.renameSync(result.archivePath, tempArchivePath);
    } catch (err) {
      // Clean up and propagate error
      try {
        fs.unlinkSync(result.archivePath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Failed to rename archive to temporary path: ${err}`);
    }

    // Prepare entry metadata
    const expiresAt = this.calculateExpiresAt();
    const now = new Date().toISOString();

    // PHASE B: Fast commit with lock (~10ms)
    return this.lockManager.withLock(async () => {
      let index = await this.indexStore.load();

      // Check if entry already exists (idempotency)
      const existing = findEntry(index, key);
      if (existing) {
        core.info(`Cache entry already exists for key: ${key}`);
        // Clean up temp archive
        try {
          fs.unlinkSync(tempArchivePath);
        } catch {
          // Ignore cleanup errors
        }
        return existing;
      }

      // Clean up expired entries opportunistically
      const { index: cleanedIndex, deletedCount } = await this.cleanupExpiredEntries(index);
      if (deletedCount > 0) {
        core.info(`Cleaned up ${deletedCount} expired cache entries`);
      }
      index = cleanedIndex;

      // Check if we need to evict entries before adding (defers deletion)
      const { index: evictedIndex, toDelete } = await this.maybeEvict(index, result.sizeBytes);
      index = evictedIndex;

      // Atomic operations: finalize archive, write manifest, update index
      try {
        // 1. Finalize archive: .tmp.timestamp.pid → final (atomic rename)
        const finalArchivePath = tempArchivePath.replace(/\.tmp\.\d+\.\d+$/, '');
        fs.renameSync(tempArchivePath, finalArchivePath);

        const entry: CacheEntry = {
          key,
          archivePath: path.relative(this.cacheDir, finalArchivePath),
          createdAt: now,
          sizeBytes: result.sizeBytes,
          expiresAt,
          accessedAt: now,
        };

        // 2. Write manifest
        const manifest = entryToManifest(entry, result.compressionMethod);
        await writeManifest(finalArchivePath, manifest);

        // 3. Update index
        const updatedIndex = addEntry(index, entry);
        await this.indexStore.save(updatedIndex);

        // 4. Delete evicted entries AFTER index save succeeds
        if (toDelete.length > 0) {
          await this.deleteEvictedEntries(toDelete);
        }

        core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

        return entry;
      } catch (err) {
        // Rollback: clean up finalized archive and manifest if they exist
        const finalArchivePath = tempArchivePath.replace(/\.tmp\.\d+\.\d+$/, '');
        try {
          if (fs.existsSync(finalArchivePath)) {
            fs.unlinkSync(finalArchivePath);
            // Delete manifest file as well
            await deleteManifest(finalArchivePath);
          }
          if (fs.existsSync(tempArchivePath)) {
            fs.unlinkSync(tempArchivePath);
          }
        } catch {
          // Ignore cleanup errors
        }

        // Rethrow original error
        throw err;
      }
    });
  }
}

/**
 * Create a local storage provider
 * This is the main factory function for backward compatibility
 */
export function createLocalStorageProvider(
  basePath: string,
  owner: string,
  repo: string,
  options?: LocalStorageOptions
): StorageProvider {
  return new LocalStorageProvider(basePath, owner, repo, options);
}
