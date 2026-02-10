import * as path from 'path';
import * as core from '@actions/core';
import { StorageProvider } from '../interfaces';
import { BaseStorageProvider, BaseStorageOptions, formatBytes } from '../baseProvider';
import { LocalStorageBackend, createLocalStorageBackend } from './localBackend';
import { createFileIndexStore } from './fileIndexStore';
import { createFileLockManager } from './fileLockManager';
import { CacheEntry, findEntry, addEntry } from '../../keyResolver/indexManager';
import { createArchive, extractArchive } from '../../archive/tar';
import { CompressionOptions } from '../../archive/compression';

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
    return this.lockManager.withLock(async () => {
      let index = await this.indexStore.load();

      // Check if entry already exists
      const existing = findEntry(index, key);
      if (existing) {
        core.info(`Cache entry already exists for key: ${key}`);
        return existing;
      }

      // Clean up expired entries opportunistically
      const { index: cleanedIndex, deletedCount } = await this.cleanupExpiredEntries(index);
      if (deletedCount > 0) {
        core.info(`Cleaned up ${deletedCount} expired cache entries`);
      }
      index = cleanedIndex;

      // Create archive
      const archivesDir = await this.localBackend.ensureArchivesDir();
      core.info(`Creating cache archive for ${paths.length} path(s)`);

      const compressionOptions = this.options.compression as CompressionOptions | undefined;
      const result = await createArchive(paths, archivesDir, undefined, compressionOptions);

      // Calculate expiration time
      const expiresAt = this.calculateExpiresAt();
      const now = new Date().toISOString();

      const entry: CacheEntry = {
        key,
        archivePath: path.relative(this.cacheDir, result.archivePath),
        createdAt: now,
        sizeBytes: result.sizeBytes,
        expiresAt,
        accessedAt: now,
      };

      // Check if we need to evict entries before adding
      index = await this.maybeEvict(index, entry.sizeBytes);

      // Update index
      const updatedIndex = addEntry(index, entry);
      await this.indexStore.save(updatedIndex);

      core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

      return entry;
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
