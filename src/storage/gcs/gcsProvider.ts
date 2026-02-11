import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as core from '@actions/core';
import * as io from '@actions/io';
import { StorageProvider, GCSStorageOptions } from '../interfaces';
import { BaseStorageProvider, BaseStorageOptions, formatBytes } from '../baseProvider';
import { GCSStorageBackend, createGCSStorageBackend } from './gcsBackend';
import { createGCSIndexStore } from './gcsIndexStore';
import { createGCSLockManager } from './gcsLockManager';
import { CacheEntry, findEntry, addEntry } from '../../keyResolver/indexManager';
import { createArchive, extractArchive } from '../../archive/tar';
import { CompressionOptions } from '../../archive/compression';

/**
 * Options for GCS storage provider
 */
export interface GCSProviderOptions extends BaseStorageOptions {
  compression?: CompressionOptions;
}

/**
 * Google Cloud Storage provider
 * Uses GCS for artifact storage
 */
export class GCSStorageProvider extends BaseStorageProvider implements StorageProvider {
  private readonly gcsOptions: GCSStorageOptions;
  private readonly owner: string;
  private readonly repo: string;
  private readonly gcsBackend: GCSStorageBackend;

  constructor(
    gcsOptions: GCSStorageOptions,
    owner: string,
    repo: string,
    options: GCSProviderOptions = {}
  ) {
    const gcsBackend = createGCSStorageBackend({
      ...gcsOptions,
      // Adjust prefix to include owner/repo
      prefix: `${gcsOptions.prefix || 'gha-cache/'}${owner}/${repo}/`,
    });
    const indexStore = createGCSIndexStore(gcsOptions, owner, repo);
    const lockManager = createGCSLockManager(gcsOptions, owner, repo);

    super(gcsBackend, indexStore, lockManager, options);

    this.gcsOptions = gcsOptions;
    this.owner = owner;
    this.repo = repo;
    this.gcsBackend = gcsBackend;
  }

  async restore(entry: CacheEntry): Promise<void> {
    // Check if archive exists
    if (!(await this.backend.exists(entry.archivePath))) {
      throw new Error(`Cache archive not found: ${entry.archivePath}`);
    }

    // Download archive to temp file
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gha-cache-'));
    const tempArchive = path.join(tempDir, path.basename(entry.archivePath));

    try {
      core.info(`Downloading cache archive from GCS...`);
      const data = await this.backend.get(entry.archivePath);
      // GCS backend always returns Buffer
      if (Buffer.isBuffer(data)) {
        fs.writeFileSync(tempArchive, data);
      } else {
        // Handle Readable stream (shouldn't happen with GCS backend's get())
        const chunks: Buffer[] = [];
        for await (const chunk of data) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fs.writeFileSync(tempArchive, Buffer.concat(chunks));
      }

      core.info(`Extracting cache...`);
      await extractArchive(tempArchive, process.cwd());
      core.info(`Cache restored successfully`);

      // Update accessedAt for LRU tracking (best-effort)
      await this.updateAccessTimeForEntry(entry.key);
    } finally {
      // Clean up temp directory
      try {
        await io.rmRF(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
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

      // Create archive in temp directory
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gha-cache-'));

      try {
        core.info(`Creating cache archive for ${paths.length} path(s)`);

        const compressionOptions = this.options.compression as CompressionOptions | undefined;
        const result = await createArchive(paths, tempDir, undefined, compressionOptions);

        // Upload to GCS
        core.info(`Uploading cache archive to GCS...`);
        const location = await this.gcsBackend.putFromPath(result.archivePath);

        // Calculate expiration time
        const expiresAt = this.calculateExpiresAt();
        const now = new Date().toISOString();

        const entry: CacheEntry = {
          key,
          archivePath: location,
          createdAt: now,
          sizeBytes: result.sizeBytes,
          expiresAt,
          accessedAt: now,
        };

        // Check if we need to evict entries before adding (defers deletion)
        const { index: evictedIndex, toDelete } = await this.maybeEvict(index, entry.sizeBytes);
        index = evictedIndex;

        // Update index
        const updatedIndex = addEntry(index, entry);
        await this.indexStore.save(updatedIndex);

        // Delete evicted entries AFTER index save succeeds
        if (toDelete.length > 0) {
          await this.deleteEvictedEntries(toDelete);
        }

        core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

        return entry;
      } finally {
        // Clean up temp directory
        try {
          await io.rmRF(tempDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  }
}

/**
 * Create a GCS storage provider
 */
export function createGCSStorageProvider(
  gcsOptions: GCSStorageOptions,
  owner: string,
  repo: string,
  options?: GCSProviderOptions
): StorageProvider {
  return new GCSStorageProvider(gcsOptions, owner, repo, options);
}
