import {
  StorageProvider,
  StorageProviderConfig,
  LocalStorageOptions,
  S3StorageOptions,
  CustomStorageOptions,
} from './interfaces';
import {
  createLocalStorageProvider,
  LocalStorageOptions as LocalProviderOptions,
} from './local/localProvider';
import { createS3StorageProvider, S3ProviderOptions } from './s3/s3Provider';
import { CompressionOptions } from '../archive/compression';

/**
 * Create a storage provider based on configuration
 *
 * @param config - Storage provider configuration
 * @returns Configured storage provider instance
 *
 * @example
 * ```typescript
 * // Local storage
 * const provider = await createStorageProvider({
 *   type: 'local',
 *   owner: 'myorg',
 *   repo: 'myrepo',
 *   options: { basePath: '/srv/gha-cache/v1' },
 * });
 *
 * // S3 storage
 * const provider = await createStorageProvider({
 *   type: 's3',
 *   owner: 'myorg',
 *   repo: 'myrepo',
 *   options: {
 *     bucket: 'my-cache-bucket',
 *     region: 'us-east-1',
 *   },
 * });
 *
 * // Custom provider
 * const provider = await createStorageProvider({
 *   type: 'custom',
 *   owner: 'myorg',
 *   repo: 'myrepo',
 *   options: {
 *     createProvider: async (config) => new MyCustomProvider(config),
 *   },
 * });
 * ```
 */
export async function createStorageProvider(
  config: StorageProviderConfig
): Promise<StorageProvider> {
  const { type, owner, repo, options, ttlDays, maxCacheSizeGb, compression } = config;

  // Convert compression config to CompressionOptions
  const compressionOptions: CompressionOptions | undefined = compression
    ? { method: compression.method, level: compression.level }
    : undefined;

  switch (type) {
    case 'local': {
      const localOptions = options as LocalStorageOptions;
      const providerOptions: LocalProviderOptions = {
        ttlDays,
        maxCacheSizeGb,
        compression: compressionOptions,
      };
      return createLocalStorageProvider(localOptions.basePath, owner, repo, providerOptions);
    }

    case 's3': {
      const s3Options = options as S3StorageOptions;
      const providerOptions: S3ProviderOptions = {
        ttlDays,
        maxCacheSizeGb,
        compression: compressionOptions,
      };
      return createS3StorageProvider(s3Options, owner, repo, providerOptions);
    }

    case 'custom': {
      const customOptions = options as CustomStorageOptions;
      if (!customOptions.createProvider) {
        throw new Error('Custom storage provider requires a createProvider function');
      }
      return customOptions.createProvider(config);
    }

    default:
      throw new Error(`Unknown storage provider type: ${type}`);
  }
}

/**
 * Check if a storage type is valid
 */
export function isValidStorageType(type: string): type is 'local' | 's3' | 'custom' {
  return ['local', 's3', 'custom'].includes(type);
}

/**
 * Get the default storage type
 */
export function getDefaultStorageType(): 'local' {
  return 'local';
}
