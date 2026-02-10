export enum Inputs {
  Key = 'key',
  Path = 'path',
  RestoreKeys = 'restore-keys',
  UploadChunkSize = 'upload-chunk-size',
  EnableCrossOsArchive = 'enableCrossOsArchive',
  FailOnCacheMiss = 'fail-on-cache-miss',
  LookupOnly = 'lookup-only',
  SaveAlways = 'save-always',

  // Storage provider selection
  StorageProvider = 'storage-provider',

  // Local provider options
  CachePath = 'cache-path',

  // S3 provider options
  S3Bucket = 's3-bucket',
  S3Region = 's3-region',
  S3Endpoint = 's3-endpoint',
  S3Prefix = 's3-prefix',
  S3ForcePathStyle = 's3-force-path-style',

  // GCS provider options
  GCSBucket = 'gcs-bucket',
  GCSProject = 'gcs-project',
  GCSPrefix = 'gcs-prefix',
  GCSKeyFile = 'gcs-key-file',

  // Common options
  Compression = 'compression',
  CompressionLevel = 'compression-level',
  TtlDays = 'ttl-days',
  MaxCacheSizeGb = 'max-cache-size-gb',
}

export enum Outputs {
  CacheHit = 'cache-hit',
  CachePrimaryKey = 'cache-primary-key',
  CacheMatchedKey = 'cache-matched-key',
}

export enum State {
  CachePrimaryKey = 'CACHE_PRIMARY_KEY',
  CacheMatchedKey = 'CACHE_MATCHED_KEY',
  CachePaths = 'CACHE_PATHS',
}

export const DEFAULT_CACHE_PATH = '/srv/gha-cache/v1';
export const INDEX_FILE = 'index.json';
export const ARCHIVES_DIR = 'archives';
export const INDEX_VERSION = '2';

// Compression defaults
export const DEFAULT_COMPRESSION = 'auto';
export const DEFAULT_ZSTD_LEVEL = 3;
export const DEFAULT_GZIP_LEVEL = 6;

// TTL and size defaults
export const DEFAULT_TTL_DAYS = 30;
export const DEFAULT_MAX_CACHE_SIZE_GB = 10;
export const BYTES_PER_GB = 1024 * 1024 * 1024;

export const LOCK_OPTIONS = {
  retries: {
    retries: 5,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 5000,
  },
  stale: 30000, // 30 seconds
};
