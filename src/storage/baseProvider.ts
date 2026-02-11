import * as core from '@actions/core';
import {
  StorageProvider,
  StorageBackend,
  IndexStore,
  LockManager,
  ResolveResult,
  CompressionOptionsConfig,
} from './interfaces';
import {
  CacheEntry,
  CacheIndex,
  addEntry,
  findEntry,
  isExpired,
  filterValidEntries,
  getTotalCacheSize,
  getEntriesByLRU,
  updateAccessTime,
} from '../keyResolver/indexManager';
import { resolveKey } from '../keyResolver/resolver';
import { BYTES_PER_GB } from '../constants';

/**
 * Options for base storage provider
 */
export interface BaseStorageOptions {
  /** TTL in days (0 = no expiration) */
  ttlDays?: number;
  /** Maximum cache size in GB (0 = unlimited) */
  maxCacheSizeGb?: number;
  /** Compression options */
  compression?: CompressionOptionsConfig;
}

/**
 * Base class for storage providers
 * Implements common logic for resolve, LRU eviction, and expiration
 * Subclasses implement backend-specific save/restore operations
 */
export abstract class BaseStorageProvider implements StorageProvider {
  protected readonly backend: StorageBackend;
  protected readonly indexStore: IndexStore;
  protected readonly lockManager: LockManager;
  protected readonly options: BaseStorageOptions;

  constructor(
    backend: StorageBackend,
    indexStore: IndexStore,
    lockManager: LockManager,
    options: BaseStorageOptions = {}
  ) {
    this.backend = backend;
    this.indexStore = indexStore;
    this.lockManager = lockManager;
    this.options = options;
  }

  async resolve(primaryKey: string, restoreKeys: string[]): Promise<ResolveResult> {
    return this.lockManager.withLock(async () => {
      const index = await this.indexStore.load();
      return resolveKey(index, primaryKey, restoreKeys);
    });
  }

  /**
   * Restore cache entry - implemented by subclasses
   */
  abstract restore(entry: CacheEntry): Promise<void>;

  /**
   * Save cache entry - implemented by subclasses
   */
  abstract save(key: string, paths: string[]): Promise<CacheEntry>;

  async exists(key: string): Promise<boolean> {
    return this.lockManager.withLock(async () => {
      const index = await this.indexStore.load();
      const entry = findEntry(index, key);
      // Entry exists if found and not expired
      return entry !== undefined && !isExpired(entry);
    });
  }

  async getIndex(): Promise<CacheIndex> {
    return this.lockManager.withLock(async () => {
      return this.indexStore.load();
    });
  }

  /**
   * Clean up expired entries and delete their archive files
   */
  protected async cleanupExpiredEntries(
    index: CacheIndex
  ): Promise<{ index: CacheIndex; deletedCount: number }> {
    const now = new Date();
    const validEntries: CacheEntry[] = [];
    let deletedCount = 0;

    for (const entry of index.entries) {
      if (isExpired(entry, now)) {
        // Delete the archive
        try {
          if (await this.backend.exists(entry.archivePath)) {
            await this.backend.delete(entry.archivePath);
            core.debug(`Deleted expired archive: ${entry.key}`);
          }
        } catch (err) {
          core.debug(`Failed to delete archive ${entry.archivePath}: ${err}`);
        }

        // Delete manifest for local provider
        await this.deleteManifestIfLocal(entry.archivePath);

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
   */
  protected async evictToSize(index: CacheIndex, targetBytes: number): Promise<CacheIndex> {
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
      try {
        if (await this.backend.exists(entry.archivePath)) {
          await this.backend.delete(entry.archivePath);
          core.info(`Evicted cache entry (LRU): ${entry.key} (${formatBytes(entry.sizeBytes)})`);
        }
      } catch (err) {
        core.debug(`Failed to delete evicted archive ${entry.archivePath}: ${err}`);
      }

      // Delete manifest for local provider
      await this.deleteManifestIfLocal(entry.archivePath);
    }

    if (evictedEntries.length > 0) {
      core.info(`Evicted ${evictedEntries.length} entries to stay under cache size limit`);
    }

    return { ...index, entries: remainingEntries };
  }

  /**
   * Check if eviction is needed and perform it if so
   * Returns the updated index
   */
  protected async maybeEvict(index: CacheIndex, newEntrySize: number): Promise<CacheIndex> {
    if (!this.options.maxCacheSizeGb || this.options.maxCacheSizeGb <= 0) {
      return index;
    }

    const maxBytes = this.options.maxCacheSizeGb * BYTES_PER_GB;
    const currentSize = getTotalCacheSize(index);
    const newTotalSize = currentSize + newEntrySize;

    if (newTotalSize > maxBytes) {
      // Single entry exceeds max size - allow but warn
      if (newEntrySize > maxBytes) {
        core.warning(
          `Cache entry (${formatBytes(newEntrySize)}) exceeds max cache size (${formatBytes(maxBytes)}). Entry will be saved but may be evicted immediately on next save.`
        );
        return index;
      }
      // Evict to make room
      const targetSize = maxBytes - newEntrySize;
      return this.evictToSize(index, targetSize);
    }

    return index;
  }

  /**
   * Calculate expiration date based on TTL
   */
  protected calculateExpiresAt(): string | undefined {
    if (!this.options.ttlDays || this.options.ttlDays <= 0) {
      return undefined;
    }
    const now = new Date();
    const expireDate = new Date(now);
    expireDate.setDate(expireDate.getDate() + this.options.ttlDays);
    return expireDate.toISOString();
  }

  /**
   * Update access time for LRU tracking
   * Best-effort operation that shouldn't fail the overall operation
   */
  protected async updateAccessTimeForEntry(key: string): Promise<void> {
    try {
      await this.lockManager.withLock(async () => {
        const index = await this.indexStore.load();
        const updatedIndex = updateAccessTime(index, key);
        await this.indexStore.save(updatedIndex);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.debug(`Failed to update accessedAt: ${message}`);
    }
  }

  /**
   * Add entry to index with cleanup and eviction
   */
  protected async addEntryToIndex(entry: CacheEntry): Promise<void> {
    let index = await this.indexStore.load();

    // Check if entry already exists
    const existing = findEntry(index, entry.key);
    if (existing) {
      core.info(`Cache entry already exists for key: ${entry.key}`);
      return;
    }

    // Clean up expired entries opportunistically
    const { index: cleanedIndex, deletedCount } = await this.cleanupExpiredEntries(index);
    if (deletedCount > 0) {
      core.info(`Cleaned up ${deletedCount} expired cache entries`);
    }
    index = cleanedIndex;

    // Check if we need to evict entries before adding
    index = await this.maybeEvict(index, entry.sizeBytes);

    // Update index
    const updatedIndex = addEntry(index, entry);
    await this.indexStore.save(updatedIndex);
  }

  /**
   * Delete manifest file if this is a local storage backend
   * Best-effort operation - doesn't throw on failure
   */
  protected async deleteManifestIfLocal(archivePath: string): Promise<void> {
    // Only delete manifests for local storage backend
    // Check if backend has getFullPath method (local backend specific)
    if ('getFullPath' in this.backend && typeof this.backend.getFullPath === 'function') {
      try {
        // Dynamic import to avoid circular dependency
        const { deleteManifest } = await import('./local/manifestStore');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fullPath = (this.backend as any).getFullPath(archivePath);
        await deleteManifest(fullPath);
      } catch (err) {
        core.debug(`Failed to delete manifest for ${archivePath}: ${err}`);
      }
    }
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
