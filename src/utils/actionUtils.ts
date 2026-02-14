import * as core from '@actions/core';
import {
  Inputs,
  getDefaultCachePath,
  DEFAULT_COMPRESSION,
  DEFAULT_TTL_DAYS,
  DEFAULT_MAX_CACHE_SIZE_GB,
} from '../constants';
import { CompressionMethod, CompressionOptions } from '../archive/compression';
import {
  StorageProviderConfig,
  LocalStorageOptions,
  S3StorageOptions,
  GCSStorageOptions,
} from '../storage/interfaces';

/**
 * Storage provider type
 */
export type StorageProviderType = 'local' | 's3' | 'gcs';

/**
 * S3 provider inputs
 */
export interface S3Inputs {
  bucket: string;
  region: string;
  endpoint?: string;
  prefix: string;
  forcePathStyle: boolean;
}

/**
 * GCS provider inputs
 */
export interface GCSInputs {
  bucket: string;
  projectId?: string;
  keyFile?: string;
  prefix: string;
}

export interface ActionInputs {
  key: string;
  paths: string[];
  restoreKeys: string[];
  failOnCacheMiss: boolean;
  lookupOnly: boolean;
  saveAlways: boolean;
  storageProvider: StorageProviderType;
  cachePath: string;
  isExplicitCachePath: boolean;
  s3: S3Inputs;
  gcs: GCSInputs;
  compression: CompressionOptions;
  ttlDays: number;
  maxCacheSizeGb: number;
}

export type RestoreInputs = Pick<
  ActionInputs,
  | 'key'
  | 'paths'
  | 'restoreKeys'
  | 'failOnCacheMiss'
  | 'lookupOnly'
  | 'storageProvider'
  | 'cachePath'
  | 'isExplicitCachePath'
  | 's3'
  | 'gcs'
>;

export type SaveInputs = Pick<
  ActionInputs,
  | 'key'
  | 'paths'
  | 'storageProvider'
  | 'cachePath'
  | 'isExplicitCachePath'
  | 's3'
  | 'gcs'
  | 'compression'
  | 'ttlDays'
  | 'maxCacheSizeGb'
>;

// Regex for strict integer validation (optional leading minus, digits only)
const STRICT_INTEGER_REGEX = /^-?\d+$/;

// Regex for strict float validation (optional leading minus, digits with optional decimal)
const STRICT_FLOAT_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * Validate that a string is a strict integer (no trailing characters)
 */
function isStrictInteger(value: string): boolean {
  return STRICT_INTEGER_REGEX.test(value.trim());
}

/**
 * Validate that a string is a strict number (no trailing characters)
 */
function isStrictNumber(value: string): boolean {
  return STRICT_FLOAT_REGEX.test(value.trim());
}

/**
 * Parse compression method from input string
 */
function parseCompressionMethod(value: string): CompressionMethod | 'auto' {
  const normalized = value.toLowerCase().trim();
  const validMethods = ['auto', 'zstd', 'gzip', 'none'];

  if (!validMethods.includes(normalized)) {
    core.warning(
      `Invalid compression method '${value}'. Valid values: ${validMethods.join(', ')}. Using 'auto'.`
    );
    return 'auto';
  }

  return normalized as CompressionMethod | 'auto';
}

/**
 * Parse compression level from input string
 */
function parseCompressionLevel(value: string): number | undefined {
  if (!value || value.trim() === '') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!isStrictInteger(trimmed)) {
    core.warning(`Invalid compression level '${value}'. Must be a valid integer. Using default.`);
    return undefined;
  }

  return parseInt(trimmed, 10);
}

/**
 * Parse compression options from inputs
 */
function parseCompressionOptions(): CompressionOptions {
  const method = parseCompressionMethod(core.getInput(Inputs.Compression) || DEFAULT_COMPRESSION);
  const level = parseCompressionLevel(core.getInput(Inputs.CompressionLevel));

  return { method, level };
}

/**
 * Parse TTL days from input
 */
function parseTtlDays(): number {
  const value = core.getInput(Inputs.TtlDays);
  if (!value || value.trim() === '') {
    return DEFAULT_TTL_DAYS;
  }

  const trimmed = value.trim();
  if (!isStrictInteger(trimmed) || parseInt(trimmed, 10) < 0) {
    core.warning(
      `Invalid ttl-days '${value}'. Must be non-negative integer. Using ${DEFAULT_TTL_DAYS}.\n` +
      `Tip: Use 0 for no expiration.`
    );
    return DEFAULT_TTL_DAYS;
  }

  return parseInt(trimmed, 10);
}

/**
 * Parse max cache size from input
 */
function parseMaxCacheSizeGb(): number {
  const value = core.getInput(Inputs.MaxCacheSizeGb);
  if (!value || value.trim() === '') {
    return DEFAULT_MAX_CACHE_SIZE_GB;
  }

  const trimmed = value.trim();
  if (!isStrictNumber(trimmed) || parseFloat(trimmed) < 0) {
    core.warning(
      `Invalid max-cache-size-gb '${value}'. Must be non-negative number. Using ${DEFAULT_MAX_CACHE_SIZE_GB}.\n` +
      `Tip: Use 0 for unlimited cache size.`
    );
    return DEFAULT_MAX_CACHE_SIZE_GB;
  }

  return parseFloat(trimmed);
}

/**
 * Parse storage provider type
 */
function parseStorageProvider(): StorageProviderType {
  const value = core.getInput(Inputs.StorageProvider) || 'local';
  const normalized = value.toLowerCase().trim();

  if (normalized !== 'local' && normalized !== 's3' && normalized !== 'gcs') {
    core.warning(
      `Invalid storage-provider '${value}'. Valid values: local, s3, gcs. Using 'local'.`
    );
    return 'local';
  }

  return normalized as StorageProviderType;
}

/**
 * Parse S3 inputs
 */
function parseS3Inputs(): S3Inputs {
  return {
    bucket: core.getInput(Inputs.S3Bucket) || '',
    region: core.getInput(Inputs.S3Region) || 'us-east-1',
    endpoint: core.getInput(Inputs.S3Endpoint) || undefined,
    prefix: core.getInput(Inputs.S3Prefix) || 'gha-cache/',
    forcePathStyle: core.getInput(Inputs.S3ForcePathStyle).toLowerCase() === 'true',
  };
}

/**
 * Parse GCS inputs
 */
function parseGCSInputs(): GCSInputs {
  return {
    bucket: core.getInput(Inputs.GCSBucket) || '',
    projectId: core.getInput(Inputs.GCSProject) || undefined,
    keyFile: core.getInput(Inputs.GCSKeyFile) || undefined,
    prefix: core.getInput(Inputs.GCSPrefix) || 'gha-cache/',
  };
}

/**
 * Validate S3 inputs
 * Throws if S3 provider is selected but bucket is not specified
 */
function validateS3Inputs(storageProvider: StorageProviderType, s3: S3Inputs): void {
  if (storageProvider === 's3' && !s3.bucket) {
    throw new Error('s3-bucket is required when using s3 storage provider');
  }
}

/**
 * Validate GCS inputs
 * Throws if GCS provider is selected but bucket is not specified
 */
function validateGCSInputs(storageProvider: StorageProviderType, gcs: GCSInputs): void {
  if (storageProvider === 'gcs' && !gcs.bucket) {
    throw new Error('gcs-bucket is required when using gcs storage provider');
  }
}

export function getInputs(): ActionInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const restoreKeys = core.getInput(Inputs.RestoreKeys).split('\n').filter(Boolean);
  const failOnCacheMiss = core.getBooleanInput(Inputs.FailOnCacheMiss);
  const lookupOnly = core.getBooleanInput(Inputs.LookupOnly);
  const saveAlways = core.getBooleanInput(Inputs.SaveAlways);
  const storageProvider = parseStorageProvider();
  const cachePathInput = core.getInput(Inputs.CachePath);
  const isExplicitCachePath = !!cachePathInput;
  const cachePath = cachePathInput || getDefaultCachePath();
  const s3 = parseS3Inputs();
  const gcs = parseGCSInputs();
  const compression = parseCompressionOptions();
  const ttlDays = parseTtlDays();
  const maxCacheSizeGb = parseMaxCacheSizeGb();

  // Validate provider-specific inputs
  validateS3Inputs(storageProvider, s3);
  validateGCSInputs(storageProvider, gcs);

  return {
    key,
    paths,
    restoreKeys,
    failOnCacheMiss,
    lookupOnly,
    saveAlways,
    storageProvider,
    cachePath,
    isExplicitCachePath,
    s3,
    gcs,
    compression,
    ttlDays,
    maxCacheSizeGb,
  };
}

export function getRestoreInputs(): RestoreInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const restoreKeys = core.getInput(Inputs.RestoreKeys).split('\n').filter(Boolean);
  const failOnCacheMiss = core.getBooleanInput(Inputs.FailOnCacheMiss);
  const lookupOnly = core.getBooleanInput(Inputs.LookupOnly);
  const storageProvider = parseStorageProvider();
  const cachePathInput = core.getInput(Inputs.CachePath);
  const isExplicitCachePath = !!cachePathInput;
  const cachePath = cachePathInput || getDefaultCachePath();
  const s3 = parseS3Inputs();
  const gcs = parseGCSInputs();

  // Validate provider-specific inputs
  validateS3Inputs(storageProvider, s3);
  validateGCSInputs(storageProvider, gcs);

  return {
    key,
    paths,
    restoreKeys,
    failOnCacheMiss,
    lookupOnly,
    storageProvider,
    cachePath,
    isExplicitCachePath,
    s3,
    gcs,
  };
}

export function getSaveInputs(): SaveInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const storageProvider = parseStorageProvider();
  const cachePathInput = core.getInput(Inputs.CachePath);
  const isExplicitCachePath = !!cachePathInput;
  const cachePath = cachePathInput || getDefaultCachePath();
  const s3 = parseS3Inputs();
  const gcs = parseGCSInputs();
  const compression = parseCompressionOptions();
  const ttlDays = parseTtlDays();
  const maxCacheSizeGb = parseMaxCacheSizeGb();

  // Validate provider-specific inputs
  validateS3Inputs(storageProvider, s3);
  validateGCSInputs(storageProvider, gcs);

  return {
    key,
    paths,
    storageProvider,
    cachePath,
    isExplicitCachePath,
    s3,
    gcs,
    compression,
    ttlDays,
    maxCacheSizeGb,
  };
}

export function getRepoInfo(): { owner: string; repo: string } {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(
      'Unable to determine repository. Ensure GITHUB_REPOSITORY environment variable is set.'
    );
  }
  return { owner, repo };
}

export function isExactKeyMatch(key: string, matchedKey: string | undefined): boolean {
  return key === matchedKey;
}

/**
 * Create a storage provider config from restore inputs
 */
export function createRestoreStorageConfig(
  inputs: RestoreInputs,
  owner: string,
  repo: string
): StorageProviderConfig {
  if (inputs.storageProvider === 's3') {
    return {
      type: 's3',
      owner,
      repo,
      options: {
        bucket: inputs.s3.bucket,
        region: inputs.s3.region,
        endpoint: inputs.s3.endpoint,
        prefix: inputs.s3.prefix,
        forcePathStyle: inputs.s3.forcePathStyle,
      } as S3StorageOptions,
    };
  }

  if (inputs.storageProvider === 'gcs') {
    return {
      type: 'gcs',
      owner,
      repo,
      options: {
        bucket: inputs.gcs.bucket,
        projectId: inputs.gcs.projectId,
        keyFilename: inputs.gcs.keyFile,
        prefix: inputs.gcs.prefix,
      } as GCSStorageOptions,
    };
  }

  return {
    type: 'local',
    owner,
    repo,
    options: {
      basePath: inputs.cachePath,
    } as LocalStorageOptions,
  };
}

/**
 * Create a storage provider config from save inputs
 */
export function createSaveStorageConfig(
  inputs: SaveInputs,
  owner: string,
  repo: string
): StorageProviderConfig {
  const baseConfig = {
    ttlDays: inputs.ttlDays,
    maxCacheSizeGb: inputs.maxCacheSizeGb,
    compression: {
      method: inputs.compression.method,
      level: inputs.compression.level,
    },
  };

  if (inputs.storageProvider === 's3') {
    return {
      type: 's3',
      owner,
      repo,
      options: {
        bucket: inputs.s3.bucket,
        region: inputs.s3.region,
        endpoint: inputs.s3.endpoint,
        prefix: inputs.s3.prefix,
        forcePathStyle: inputs.s3.forcePathStyle,
      } as S3StorageOptions,
      ...baseConfig,
    };
  }

  if (inputs.storageProvider === 'gcs') {
    return {
      type: 'gcs',
      owner,
      repo,
      options: {
        bucket: inputs.gcs.bucket,
        projectId: inputs.gcs.projectId,
        keyFilename: inputs.gcs.keyFile,
        prefix: inputs.gcs.prefix,
      } as GCSStorageOptions,
      ...baseConfig,
    };
  }

  return {
    type: 'local',
    owner,
    repo,
    options: {
      basePath: inputs.cachePath,
    } as LocalStorageOptions,
    ...baseConfig,
  };
}
