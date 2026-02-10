import * as core from '@actions/core';
import {
  Inputs,
  DEFAULT_CACHE_PATH,
  DEFAULT_COMPRESSION,
  DEFAULT_TTL_DAYS,
  DEFAULT_MAX_CACHE_SIZE_GB,
} from '../constants';
import { CompressionMethod, CompressionOptions } from '../archive/compression';

export interface ActionInputs {
  key: string;
  paths: string[];
  restoreKeys: string[];
  failOnCacheMiss: boolean;
  lookupOnly: boolean;
  saveAlways: boolean;
  cachePath: string;
  compression: CompressionOptions;
  ttlDays: number;
  maxCacheSizeGb: number;
}

export type RestoreInputs = Pick<
  ActionInputs,
  'key' | 'paths' | 'restoreKeys' | 'failOnCacheMiss' | 'lookupOnly' | 'cachePath'
>;

export type SaveInputs = Pick<
  ActionInputs,
  'key' | 'paths' | 'cachePath' | 'compression' | 'ttlDays' | 'maxCacheSizeGb'
>;

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

  const level = parseInt(value, 10);
  if (isNaN(level)) {
    core.warning(`Invalid compression level '${value}'. Using default.`);
    return undefined;
  }

  return level;
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

  const days = parseInt(value, 10);
  if (isNaN(days) || days < 0) {
    core.warning(
      `Invalid ttl-days '${value}'. Must be >= 0. Using default of ${DEFAULT_TTL_DAYS}.`
    );
    return DEFAULT_TTL_DAYS;
  }

  return days;
}

/**
 * Parse max cache size from input
 */
function parseMaxCacheSizeGb(): number {
  const value = core.getInput(Inputs.MaxCacheSizeGb);
  if (!value || value.trim() === '') {
    return DEFAULT_MAX_CACHE_SIZE_GB;
  }

  const size = parseFloat(value);
  if (isNaN(size) || size < 0) {
    core.warning(
      `Invalid max-cache-size-gb '${value}'. Must be >= 0. Using default of ${DEFAULT_MAX_CACHE_SIZE_GB}.`
    );
    return DEFAULT_MAX_CACHE_SIZE_GB;
  }

  return size;
}

export function getInputs(): ActionInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const restoreKeys = core.getInput(Inputs.RestoreKeys).split('\n').filter(Boolean);
  const failOnCacheMiss = core.getBooleanInput(Inputs.FailOnCacheMiss);
  const lookupOnly = core.getBooleanInput(Inputs.LookupOnly);
  const saveAlways = core.getBooleanInput(Inputs.SaveAlways);
  const cachePath = core.getInput(Inputs.CachePath) || DEFAULT_CACHE_PATH;
  const compression = parseCompressionOptions();
  const ttlDays = parseTtlDays();
  const maxCacheSizeGb = parseMaxCacheSizeGb();

  return {
    key,
    paths,
    restoreKeys,
    failOnCacheMiss,
    lookupOnly,
    saveAlways,
    cachePath,
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
  const cachePath = core.getInput(Inputs.CachePath) || DEFAULT_CACHE_PATH;

  return {
    key,
    paths,
    restoreKeys,
    failOnCacheMiss,
    lookupOnly,
    cachePath,
  };
}

export function getSaveInputs(): SaveInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const cachePath = core.getInput(Inputs.CachePath) || DEFAULT_CACHE_PATH;
  const compression = parseCompressionOptions();
  const ttlDays = parseTtlDays();
  const maxCacheSizeGb = parseMaxCacheSizeGb();

  return { key, paths, cachePath, compression, ttlDays, maxCacheSizeGb };
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
