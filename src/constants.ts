export enum Inputs {
  Key = 'key',
  Path = 'path',
  RestoreKeys = 'restore-keys',
  UploadChunkSize = 'upload-chunk-size',
  EnableCrossOsArchive = 'enableCrossOsArchive',
  FailOnCacheMiss = 'fail-on-cache-miss',
  LookupOnly = 'lookup-only',
  SaveAlways = 'save-always',
  CachePath = 'cache-path',
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
export const INDEX_VERSION = '1';

export const LOCK_OPTIONS = {
  retries: {
    retries: 5,
    factor: 2,
    minTimeout: 100,
    maxTimeout: 5000,
  },
  stale: 30000, // 30 seconds
};
