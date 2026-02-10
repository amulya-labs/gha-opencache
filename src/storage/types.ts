import { CacheEntry, CacheIndex } from '../keyResolver/indexManager';
import { ResolveResult } from '../keyResolver/resolver';

export interface StorageProvider {
  /**
   * Resolves a cache key and returns the matching entry if found
   */
  resolve(primaryKey: string, restoreKeys: string[]): Promise<ResolveResult>;

  /**
   * Extracts the cache archive to the current working directory
   */
  restore(entry: CacheEntry): Promise<void>;

  /**
   * Creates and stores a cache archive for the given paths
   */
  save(key: string, paths: string[]): Promise<CacheEntry>;

  /**
   * Checks if a cache entry exists for the given key
   */
  exists(key: string): Promise<boolean>;

  /**
   * Gets the current cache index
   */
  getIndex(): Promise<CacheIndex>;
}
