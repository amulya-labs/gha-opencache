import * as core from '@actions/core';
import { restoreCache } from '../../src/restoreImpl';
import { createStorageProvider } from '../../src/storage/factory';
import {
  getRestoreInputs,
  getRepoInfo,
  isExactKeyMatch,
  createRestoreStorageConfig,
} from '../../src/utils/actionUtils';
import { IStateProvider } from '../../src/utils/stateProvider';
import { maybeWarnContainerConfig } from '../../src/utils/containerWarnings';
import { Outputs, State } from '../../src/constants';
import { StorageProvider } from '../../src/storage/interfaces';

jest.mock('@actions/core');
jest.mock('../../src/storage/factory');
jest.mock('../../src/utils/actionUtils');
jest.mock('../../src/utils/containerWarnings');

describe('restoreImpl', () => {
  const mockCore = core as jest.Mocked<typeof core>;
  const mockCreateStorageProvider = createStorageProvider as jest.MockedFunction<
    typeof createStorageProvider
  >;
  const mockGetRestoreInputs = getRestoreInputs as jest.MockedFunction<typeof getRestoreInputs>;
  const mockGetRepoInfo = getRepoInfo as jest.MockedFunction<typeof getRepoInfo>;
  const mockIsExactKeyMatch = isExactKeyMatch as jest.MockedFunction<typeof isExactKeyMatch>;
  const mockCreateRestoreStorageConfig = createRestoreStorageConfig as jest.MockedFunction<
    typeof createRestoreStorageConfig
  >;
  const mockMaybeWarnContainerConfig = maybeWarnContainerConfig as jest.MockedFunction<
    typeof maybeWarnContainerConfig
  >;

  let mockStateProvider: jest.Mocked<IStateProvider>;
  let mockStorage: jest.Mocked<StorageProvider>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStateProvider = {
      getState: jest.fn(),
      saveState: jest.fn(),
      getCacheState: jest.fn(),
    };

    mockStorage = {
      resolve: jest.fn(),
      restore: jest.fn(),
      save: jest.fn(),
      exists: jest.fn(),
      getIndex: jest.fn(),
    };

    mockGetRepoInfo.mockReturnValue({ owner: 'test-owner', repo: 'test-repo' });
    mockCreateStorageProvider.mockResolvedValue(mockStorage);
  });

  describe('restoreCache', () => {
    describe('when cache is found with exact match', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: [],
          failOnCacheMiss: false,
          lookupOnly: false,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockIsExactKeyMatch.mockReturnValue(true);
        mockStorage.resolve.mockResolvedValue({
          entry: {
            key: 'npm-abc123',
            archivePath: '/archive/path',
            sizeBytes: 1024,
            createdAt: new Date().toISOString(),
          },
          matchedKey: 'npm-abc123',
          isExactMatch: true,
        });
      });

      it('should restore cache and return cache hit', async () => {
        const result = await restoreCache(mockStateProvider);

        expect(result.cacheHit).toBe(true);
        expect(result.matchedKey).toBe('npm-abc123');
        expect(mockStorage.restore).toHaveBeenCalled();
        expect(mockCore.setOutput).toHaveBeenCalledWith(Outputs.CacheHit, 'true');
        expect(mockCore.setOutput).toHaveBeenCalledWith(Outputs.CachePrimaryKey, 'npm-abc123');
        expect(mockCore.setOutput).toHaveBeenCalledWith(Outputs.CacheMatchedKey, 'npm-abc123');
      });

      it('should save state for matched key', async () => {
        await restoreCache(mockStateProvider);

        expect(mockStateProvider.saveState).toHaveBeenCalledWith(
          State.CachePrimaryKey,
          'npm-abc123'
        );
        expect(mockStateProvider.saveState).toHaveBeenCalledWith(
          State.CacheMatchedKey,
          'npm-abc123'
        );
        expect(mockStateProvider.saveState).toHaveBeenCalledWith(
          State.CachePaths,
          JSON.stringify(['/path/to/cache'])
        );
      });

      it('should log cache hit message', async () => {
        await restoreCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Restoring cache for key: npm-abc123');
        expect(mockCore.info).toHaveBeenCalledWith('Storage provider: local');
        expect(mockCore.info).toHaveBeenCalledWith('Cache hit for key: npm-abc123');
      });
    });

    describe('when cache is found with prefix match', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: ['npm-'],
          failOnCacheMiss: false,
          lookupOnly: false,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockIsExactKeyMatch.mockReturnValue(false);
        mockStorage.resolve.mockResolvedValue({
          entry: {
            key: 'npm-xyz789',
            archivePath: '/archive/path',
            sizeBytes: 1024,
            createdAt: new Date().toISOString(),
          },
          matchedKey: 'npm-xyz789',
          isExactMatch: false,
        });
      });

      it('should restore cache and return cache miss (prefix match)', async () => {
        const result = await restoreCache(mockStateProvider);

        expect(result.cacheHit).toBe(false);
        expect(result.matchedKey).toBe('npm-xyz789');
        expect(mockStorage.restore).toHaveBeenCalled();
        expect(mockCore.setOutput).toHaveBeenCalledWith(Outputs.CacheHit, 'false');
      });

      it('should log restored message for prefix match', async () => {
        await restoreCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Cache restored for key: npm-xyz789');
      });

      it('should log restore keys', async () => {
        await restoreCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Restore keys: npm-');
      });
    });

    describe('when cache is not found', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: [],
          failOnCacheMiss: false,
          lookupOnly: false,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockStorage.resolve.mockResolvedValue({
          entry: undefined,
          isExactMatch: false,
          matchedKey: undefined,
        });
      });

      it('should return cache miss result', async () => {
        const result = await restoreCache(mockStateProvider);

        expect(result.cacheHit).toBe(false);
        expect(result.matchedKey).toBeUndefined();
        expect(mockStorage.restore).not.toHaveBeenCalled();
        expect(mockCore.setOutput).toHaveBeenCalledWith(Outputs.CacheHit, 'false');
      });

      it('should log cache not found message', async () => {
        await restoreCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Cache not found');
      });

      it('should warn about container configuration', async () => {
        await restoreCache(mockStateProvider);

        expect(mockMaybeWarnContainerConfig).toHaveBeenCalled();
      });

      it('should save primary key and paths to state', async () => {
        await restoreCache(mockStateProvider);

        expect(mockStateProvider.saveState).toHaveBeenCalledWith(
          State.CachePrimaryKey,
          'npm-abc123'
        );
        expect(mockStateProvider.saveState).toHaveBeenCalledWith(
          State.CachePaths,
          JSON.stringify(['/path/to/cache'])
        );
      });
    });

    describe('when failOnCacheMiss is true', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: [],
          failOnCacheMiss: true,
          lookupOnly: false,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockStorage.resolve.mockResolvedValue({
          entry: undefined,
          isExactMatch: false,
          matchedKey: undefined,
        });
      });

      it('should throw error when cache not found', async () => {
        await expect(restoreCache(mockStateProvider)).rejects.toThrow(
          'Cache not found for key: npm-abc123'
        );
      });
    });

    describe('when lookupOnly is true', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: [],
          failOnCacheMiss: false,
          lookupOnly: true,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockIsExactKeyMatch.mockReturnValue(true);
        mockStorage.resolve.mockResolvedValue({
          entry: {
            key: 'npm-abc123',
            archivePath: '/archive/path',
            sizeBytes: 1024,
            createdAt: new Date().toISOString(),
          },
          matchedKey: 'npm-abc123',
          isExactMatch: true,
        });
      });

      it('should skip restore when lookupOnly is true', async () => {
        await restoreCache(mockStateProvider);

        expect(mockStorage.restore).not.toHaveBeenCalled();
        expect(mockCore.info).toHaveBeenCalledWith('Lookup only - skipping restore');
      });

      it('should still return cache hit result', async () => {
        const result = await restoreCache(mockStateProvider);

        expect(result.cacheHit).toBe(true);
        expect(result.matchedKey).toBe('npm-abc123');
      });
    });

    describe('storage provider configuration', () => {
      it('should create storage provider with correct config', async () => {
        const mockInputs = {
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: [],
          failOnCacheMiss: false,
          lookupOnly: false,
          storageProvider: 's3' as const,
          cachePath: '/tmp/cache',
          isExplicitCachePath: true,
          s3: {
            bucket: 'my-bucket',
            region: 'us-west-2',
            prefix: 'cache/',
            forcePathStyle: true,
            endpoint: 'https://s3.example.com',
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        };

        const mockConfig = {
          type: 's3' as const,
          owner: 'test-owner',
          repo: 'test-repo',
          options: mockInputs.s3,
        };

        mockGetRestoreInputs.mockReturnValue(mockInputs);
        mockCreateRestoreStorageConfig.mockReturnValue(mockConfig);
        mockStorage.resolve.mockResolvedValue({
          entry: undefined,
          isExactMatch: false,
          matchedKey: undefined,
        });

        await restoreCache(mockStateProvider);

        expect(mockCreateRestoreStorageConfig).toHaveBeenCalledWith(
          mockInputs,
          'test-owner',
          'test-repo'
        );
        expect(mockCreateStorageProvider).toHaveBeenCalledWith(mockConfig);
      });
    });

    describe('with multiple restore keys', () => {
      beforeEach(() => {
        mockGetRestoreInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          restoreKeys: ['npm-abc', 'npm-'],
          failOnCacheMiss: false,
          lookupOnly: false,
          storageProvider: 'local',
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: '',
            prefix: 'gha-cache/',
          },
        });

        mockStorage.resolve.mockResolvedValue({
          entry: undefined,
          isExactMatch: false,
          matchedKey: undefined,
        });
      });

      it('should log all restore keys', async () => {
        await restoreCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Restore keys: npm-abc, npm-');
      });

      it('should pass restore keys to storage provider', async () => {
        await restoreCache(mockStateProvider);

        expect(mockStorage.resolve).toHaveBeenCalledWith('npm-abc123', ['npm-abc', 'npm-']);
      });
    });
  });
});
