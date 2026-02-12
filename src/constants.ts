import * as os from 'os';
import * as path from 'path';

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

/**
 * Get the default cache path based on platform and environment.
 * Priority: OPENCACHE_PATH env var > platform-specific default
 */
export function getDefaultCachePath(): string {
  // Allow ops teams to override via environment variable
  const envPath = process.env.OPENCACHE_PATH;
  if (envPath) {
    return envPath;
  }

  // Platform-specific defaults following XDG/platform conventions
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%\gha-opencache
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'gha-opencache');
  }

  if (platform === 'darwin') {
    // macOS: ~/Library/Caches/gha-opencache
    return path.join(home, 'Library', 'Caches', 'gha-opencache');
  }

  // Linux/Unix: Follow XDG Base Directory spec
  // $XDG_CACHE_HOME defaults to $HOME/.cache
  const xdgCacheHome = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(xdgCacheHome, 'gha-opencache');
}
export const INDEX_FILE = 'index.json';
export const ARCHIVES_DIR = 'archives';
export const INDEX_VERSION = '2';
export const MANIFEST_VERSION = '2';

// Compression defaults
export const DEFAULT_COMPRESSION = 'auto';
export const DEFAULT_ZSTD_LEVEL = 3;
export const DEFAULT_GZIP_LEVEL = 6;

// TTL and size defaults
export const DEFAULT_TTL_DAYS = 7; // Matches GitHub Actions cache default
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
