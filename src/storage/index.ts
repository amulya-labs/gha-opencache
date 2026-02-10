// Core interfaces
export {
  StorageProvider,
  StorageBackend,
  IndexStore,
  LockManager,
  StorageProviderConfig,
  LocalStorageOptions,
  S3StorageOptions,
  CustomStorageOptions,
  StorageOptions,
  ResolveResult,
  CompressionOptionsConfig,
} from './interfaces';

// Base provider
export { BaseStorageProvider, BaseStorageOptions, formatBytes } from './baseProvider';

// Factory
export { createStorageProvider, isValidStorageType, getDefaultStorageType } from './factory';

// Local provider (for backward compatibility)
export {
  LocalStorageProvider,
  LocalStorageOptions as LocalProviderOptions,
  createLocalStorageProvider,
} from './localProvider';

// Local components
export {
  LocalStorageBackend,
  createLocalStorageBackend,
  FileIndexStore,
  createFileIndexStore,
  FileLockManager,
  createFileLockManager,
} from './local';

// S3 provider
export {
  S3StorageProvider,
  S3ProviderOptions,
  createS3StorageProvider,
  S3StorageBackend,
  createS3StorageBackend,
  S3IndexStore,
  createS3IndexStore,
  S3LockManager,
  createS3LockManager,
} from './s3';

// Legacy re-export for backward compatibility
export { StorageProvider as StorageProviderInterface } from './types';
