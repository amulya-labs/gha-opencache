import * as path from 'path';
import * as fs from 'fs';
import * as core from '@actions/core';
import { StorageProvider } from './types';
import { withLock } from './locking';
import {
  CacheEntry,
  CacheIndex,
  loadIndex,
  saveIndex,
  addEntry,
  findEntry,
  ensureArchivesDir,
  isExpired,
  filterValidEntries,
  getTotalCacheSize,
  getEntriesByLRU,
  updateAccessTime,
} from '../keyResolver/indexManager';
import { resolveKey, ResolveResult } from '../keyResolver/resolver';
import { createArchive, extractArchive } from '../archive/tar';
import { CompressionOptions } from '../archive/compression';
import { INDEX_FILE, BYTES_PER_GB } from '../constants';

export interface LocalStorageOptions {
  ttlDays?: number; // 0 = no expiration
  maxCacheSizeGb?: number; // 0 = unlimited
  compression?: CompressionOptions;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly cacheDir: string;
  private readonly lockPath: string;
  private readonly options: LocalStorageOptions;

  constructor(basePath: string, owner: string, repo: string, options: LocalStorageOptions = {}) {
    this.cacheDir = path.join(basePath, owner, repo);
    this.lockPath = path.join(this.cacheDir, `${INDEX_FILE}.lock`);
    this.options = options;
  }

  async resolve(primaryKey: string, restoreKeys: string[]): Promise<ResolveResult> {
    return withLock(this.lockPath, async () => {
      const index = await loadIndex(this.cacheDir);
      return resolveKey(index, primaryKey, restoreKeys);
    });
  }

  async restore(entry: CacheEntry): Promise<void> {
    const archivePath = path.join(this.cacheDir, entry.archivePath);

    if (!fs.existsSync(archivePath)) {
      throw new Error(`Cache archive not found: ${archivePath}`);
    }

    core.info(`Extracting cache from ${archivePath}`);
    await extractArchive(archivePath, process.cwd());
    core.info(`Cache restored successfully`);

    // Update accessedAt for LRU tracking
    // This is best-effort and shouldn't block/fail the restore
    try {
      await withLock(this.lockPath, async () => {
        const index = await loadIndex(this.cacheDir);
        const updatedIndex = updateAccessTime(index, entry.key);
        await saveIndex(this.cacheDir, updatedIndex);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.debug(`Failed to update accessedAt: ${message}`);
    }
  }

  async save(key: string, paths: string[]): Promise<CacheEntry> {
    return withLock(this.lockPath, async () => {
      let index = await loadIndex(this.cacheDir);

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
      const archivesDir = await ensureArchivesDir(this.cacheDir);
      core.info(`Creating cache archive for ${paths.length} path(s)`);

      const result = await createArchive(paths, archivesDir, undefined, this.options.compression);

      // Calculate expiration time
      const now = new Date();
      let expiresAt: string | undefined;
      if (this.options.ttlDays && this.options.ttlDays > 0) {
        const expireDate = new Date(now);
        expireDate.setDate(expireDate.getDate() + this.options.ttlDays);
        expiresAt = expireDate.toISOString();
      }

      const entry: CacheEntry = {
        key,
        archivePath: path.relative(this.cacheDir, result.archivePath),
        createdAt: now.toISOString(),
        sizeBytes: result.sizeBytes,
        expiresAt,
        accessedAt: now.toISOString(),
      };

      // Check if we need to evict entries before adding
      if (this.options.maxCacheSizeGb && this.options.maxCacheSizeGb > 0) {
        const maxBytes = this.options.maxCacheSizeGb * BYTES_PER_GB;
        const currentSize = getTotalCacheSize(index);
        const newTotalSize = currentSize + entry.sizeBytes;

        if (newTotalSize > maxBytes) {
          // Single entry exceeds max size - allow but warn
          if (entry.sizeBytes > maxBytes) {
            core.warning(
              `Cache entry (${formatBytes(entry.sizeBytes)}) exceeds max cache size (${formatBytes(maxBytes)}). Entry will be saved but may be evicted immediately on next save.`
            );
          } else {
            // Evict to make room
            const targetSize = maxBytes - entry.sizeBytes;
            index = await this.evictToSize(index, targetSize);
          }
        }
      }

      // Update index
      const updatedIndex = addEntry(index, entry);
      await saveIndex(this.cacheDir, updatedIndex);

      core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

      return entry;
    });
  }

  /**
   * Clean up expired entries and delete their archive files
   */
  private async cleanupExpiredEntries(
    index: CacheIndex
  ): Promise<{ index: CacheIndex; deletedCount: number }> {
    const now = new Date();
    const validEntries: CacheEntry[] = [];
    let deletedCount = 0;

    for (const entry of index.entries) {
      if (isExpired(entry, now)) {
        // Delete the archive file
        const archivePath = path.join(this.cacheDir, entry.archivePath);
        try {
          if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
            core.debug(`Deleted expired archive: ${entry.key}`);
          }
        } catch (err) {
          core.debug(`Failed to delete archive ${archivePath}: ${err}`);
        }
        deletedCount++;
      } else {
        validEntries.push(entry);
      }
    }

    return {
      index: { ...index, entries: validEntries },
      deletedCount,
    };
  }

  /**
   * Evict entries using LRU until total size is under targetBytes
   * Evicts least-recently-used entries first until under the target size.
   */
  private async evictToSize(index: CacheIndex, targetBytes: number): Promise<CacheIndex> {
    // Filter out expired entries first
    const validEntries = filterValidEntries(index.entries);
    let currentSize = validEntries.reduce((sum, e) => sum + e.sizeBytes, 0);

    if (currentSize <= targetBytes) {
      return { ...index, entries: validEntries };
    }

    // Sort by LRU - oldest accessed first (least recently used at start)
    const sortedByLRU = getEntriesByLRU({ ...index, entries: validEntries });
    const remainingEntries: CacheEntry[] = [...sortedByLRU];
    const evictedEntries: CacheEntry[] = [];

    // Evict from the front (least recently used) until we're under target
    while (currentSize > targetBytes && remainingEntries.length > 0) {
      const entry = remainingEntries.shift()!;
      evictedEntries.push(entry);
      currentSize -= entry.sizeBytes;
    }

    // Delete evicted archives
    for (const entry of evictedEntries) {
      const archivePath = path.join(this.cacheDir, entry.archivePath);
      try {
        if (fs.existsSync(archivePath)) {
          fs.unlinkSync(archivePath);
          core.info(`Evicted cache entry (LRU): ${entry.key} (${formatBytes(entry.sizeBytes)})`);
        }
      } catch (err) {
        core.debug(`Failed to delete evicted archive ${archivePath}: ${err}`);
      }
    }

    if (evictedEntries.length > 0) {
      core.info(`Evicted ${evictedEntries.length} entries to stay under cache size limit`);
    }

    return { ...index, entries: remainingEntries };
  }

  async exists(key: string): Promise<boolean> {
    return withLock(this.lockPath, async () => {
      const index = await loadIndex(this.cacheDir);
      const entry = findEntry(index, key);
      // Entry exists if found and not expired
      return entry !== undefined && !isExpired(entry);
    });
  }

  async getIndex(): Promise<CacheIndex> {
    return withLock(this.lockPath, async () => {
      return loadIndex(this.cacheDir);
    });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function createLocalStorageProvider(
  basePath: string,
  owner: string,
  repo: string,
  options?: LocalStorageOptions
): StorageProvider {
  return new LocalStorageProvider(basePath, owner, repo, options);
}
