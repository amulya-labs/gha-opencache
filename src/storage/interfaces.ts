import { Readable } from 'stream';
import { CacheEntry, CacheIndex } from '../keyResolver/indexManager';

/**
 * StorageBackend handles archive blob operations (put/get/delete)
 * Implementations: LocalStorageBackend, S3StorageBackend
 */
export interface StorageBackend {
  /**
   * Store archive blob, return storage location identifier
   * @param key - Cache key (used for naming)
   * @param data - Archive data as Buffer or Readable stream
   * @returns Storage location identifier (relative path or S3 key)
   */
  put(key: string, data: Buffer | Readable): Promise<string>;

  /**
   * Retrieve archive blob by location
   * @param location - Storage location returned from put()
   * @returns Archive data as Buffer or Readable stream
   */
  get(location: string): Promise<Buffer | Readable>;

  /**
   * Delete archive by location
   * @param location - Storage location to delete
   */
  delete(location: string): Promise<void>;

  /**
   * Check if archive exists at location
   * @param location - Storage location to check
   */
  exists(location: string): Promise<boolean>;

  /**
   * Get archive size in bytes
   * @param location - Storage location to measure
   */
  getSize(location: string): Promise<number>;
}

/**
 * IndexStore handles cache index metadata persistence
 * Implementations: FileIndexStore, S3IndexStore
 */
export interface IndexStore {
  /**
   * Load index, return empty index if not exists
   */
  load(): Promise<CacheIndex>;

  /**
   * Save index atomically
   * @param index - Cache index to persist
   */
  save(index: CacheIndex): Promise<void>;
}

/**
 * LockManager handles concurrency control for index operations
 * Implementations: FileLockManager, S3LockManager
 */
export interface LockManager {
  /**
   * Execute function with exclusive lock
   * @param fn - Function to execute while holding lock
   * @returns Result of the function
   */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Options for local filesystem storage
 */
export interface LocalStorageOptions {
  /** Base path for cache storage (e.g., /srv/gha-cache) */
  basePath: string;
}

/**
 * Options for S3-compatible storage
 */
export interface S3StorageOptions {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region?: string;
  /** Custom endpoint for S3-compatible services (MinIO, R2, etc.) */
  endpoint?: string;
  /** Key prefix within bucket (default: 'gha-cache/') */
  prefix?: string;
  /** Use path-style URLs (required for MinIO) */
  forcePathStyle?: boolean;
  /** AWS access key ID (optional, uses credential chain if not provided) */
  accessKeyId?: string;
  /** AWS secret access key (optional, uses credential chain if not provided) */
  secretAccessKey?: string;
}

/**
 * Options for Google Cloud Storage
 */
export interface GCSStorageOptions {
  /** GCS bucket name */
  bucket: string;
  /** GCP project ID (optional, uses default from credentials) */
  projectId?: string;
  /** Path to service account key JSON file (optional, uses ADC if not provided) */
  keyFilename?: string;
  /** Service account credentials object (optional, uses ADC if not provided) */
  credentials?: { client_email: string; private_key: string };
  /** Key prefix within bucket (default: 'gha-cache/') */
  prefix?: string;
}

/**
 * Options for custom storage provider
 */
export interface CustomStorageOptions {
  /** Factory function to create the storage provider */
  createProvider: (config: StorageProviderConfig) => Promise<StorageProvider>;
}

/**
 * Union type for all storage options
 */
export type StorageOptions =
  | LocalStorageOptions
  | S3StorageOptions
  | GCSStorageOptions
  | CustomStorageOptions;

/**
 * Configuration for storage provider instantiation
 */
export interface StorageProviderConfig {
  /** Storage provider type */
  type: 'local' | 's3' | 'gcs' | 'custom';
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Provider-specific options */
  options: StorageOptions;
  /** Cache TTL in days (0 = no expiration) */
  ttlDays?: number;
  /** Maximum cache size in GB (0 = unlimited) */
  maxCacheSizeGb?: number;
  /** Compression options */
  compression?: CompressionOptionsConfig;
}

/**
 * Compression configuration (simplified for config)
 */
export interface CompressionOptionsConfig {
  method: 'auto' | 'zstd' | 'gzip' | 'none';
  level?: number;
}

/**
 * Result from resolving a cache key
 */
export interface ResolveResult {
  /** Matched cache entry, if found */
  entry: CacheEntry | undefined;
  /** Whether this was an exact match on primary key */
  isExactMatch: boolean;
  /** The key that matched (primary or restore-key) */
  matchedKey: string | undefined;
}

/**
 * StorageProvider is the main interface for cache operations
 * This is the high-level interface that orchestrates backend, index, and locking
 */
export interface StorageProvider {
  /**
   * Resolves a cache key and returns the matching entry if found
   * @param primaryKey - Primary cache key to look up
   * @param restoreKeys - Fallback keys for prefix matching
   */
  resolve(primaryKey: string, restoreKeys: string[]): Promise<ResolveResult>;

  /**
   * Extracts the cache archive to the current working directory
   * @param entry - Cache entry to restore
   */
  restore(entry: CacheEntry): Promise<void>;

  /**
   * Creates and stores a cache archive for the given paths
   * @param key - Cache key
   * @param paths - Paths to include in the cache
   */
  save(key: string, paths: string[]): Promise<CacheEntry>;

  /**
   * Checks if a cache entry exists for the given key
   * @param key - Cache key to check
   */
  exists(key: string): Promise<boolean>;

  /**
   * Gets the current cache index
   */
  getIndex(): Promise<CacheIndex>;
}
