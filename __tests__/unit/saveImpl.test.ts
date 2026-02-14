import * as core from '@actions/core';
import { saveCache, saveCacheOnly } from '../../src/saveImpl';
import { createStorageProvider } from '../../src/storage/factory';
import {
  getSaveInputs,
  getRepoInfo,
  isExactKeyMatch,
  createSaveStorageConfig,
} from '../../src/utils/actionUtils';
import { IStateProvider } from '../../src/utils/stateProvider';
import { State } from '../../src/constants';
import { StorageProvider } from '../../src/storage/interfaces';

jest.mock('@actions/core');
jest.mock('../../src/storage/factory');
jest.mock('../../src/utils/actionUtils');

describe('saveImpl', () => {
  const mockCore = core as jest.Mocked<typeof core>;
  const mockCreateStorageProvider = createStorageProvider as jest.MockedFunction<
    typeof createStorageProvider
  >;
  const mockGetSaveInputs = getSaveInputs as jest.MockedFunction<typeof getSaveInputs>;
  const mockGetRepoInfo = getRepoInfo as jest.MockedFunction<typeof getRepoInfo>;
  const mockIsExactKeyMatch = isExactKeyMatch as jest.MockedFunction<typeof isExactKeyMatch>;
  const mockCreateSaveStorageConfig = createSaveStorageConfig as jest.MockedFunction<
    typeof createSaveStorageConfig
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

  describe('saveCache', () => {
    describe('when cache had exact hit during restore', () => {
      beforeEach(() => {
        mockGetSaveInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
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
          compression: {
            method: 'auto',
            level: undefined,
          },
          ttlDays: 7,
          maxCacheSizeGb: 10,
        });

        mockStateProvider.getState.mockImplementation((key: string) => {
          if (key === State.CachePrimaryKey) return 'npm-abc123';
          if (key === State.CachePaths) return JSON.stringify(['/path/to/cache']);
          return '';
        });
        mockStateProvider.getCacheState.mockReturnValue('npm-abc123');
        mockIsExactKeyMatch.mockReturnValue(true);
      });

      it('should skip save when primary key matches', async () => {
        const result = await saveCache(mockStateProvider);

        expect(result.saved).toBe(false);
        expect(result.key).toBe('npm-abc123');
        expect(mockStorage.save).not.toHaveBeenCalled();
      });

      it('should log skip message', async () => {
        await saveCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith(
          'Cache hit on primary key npm-abc123, skipping save'
        );
      });
    });

    describe('when cache needs to be saved', () => {
      beforeEach(() => {
        mockGetSaveInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
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
          compression: {
            method: 'zstd',
            level: 3,
          },
          ttlDays: 7,
          maxCacheSizeGb: 10,
        });

        mockStateProvider.getState.mockImplementation((key: string) => {
          if (key === State.CachePrimaryKey) return 'npm-abc123';
          if (key === State.CachePaths) return JSON.stringify(['/path/to/cache']);
          return '';
        });
        mockStateProvider.getCacheState.mockReturnValue('npm-xyz789'); // Different key
        mockIsExactKeyMatch.mockReturnValue(false);
        mockStorage.save.mockResolvedValue({
          key: 'npm-abc123',
          archivePath: '/archive/path',
          sizeBytes: 1024,
          createdAt: new Date().toISOString(),
        });
      });

      it('should save cache successfully', async () => {
        const result = await saveCache(mockStateProvider);

        expect(result.saved).toBe(true);
        expect(result.key).toBe('npm-abc123');
        expect(mockStorage.save).toHaveBeenCalledWith('npm-abc123', ['/path/to/cache']);
      });

      it('should log save messages', async () => {
        await saveCache(mockStateProvider);

        expect(mockCore.info).toHaveBeenCalledWith('Saving cache for key: npm-abc123');
        expect(mockCore.info).toHaveBeenCalledWith('Storage provider: local');
        expect(mockCore.info).toHaveBeenCalledWith('Cache saved successfully for key: npm-abc123');
      });

      it('should use paths from state when available', async () => {
        await saveCache(mockStateProvider);

        expect(mockStorage.save).toHaveBeenCalledWith('npm-abc123', ['/path/to/cache']);
      });

      it('should fallback to input paths when state is empty', async () => {
        mockStateProvider.getState.mockImplementation((key: string) => {
          if (key === State.CachePrimaryKey) return 'npm-abc123';
          return ''; // No saved paths
        });

        await saveCache(mockStateProvider);

        expect(mockStorage.save).toHaveBeenCalledWith('npm-abc123', ['/path/to/cache']);
      });
    });

    describe('when save fails', () => {
      beforeEach(() => {
        mockGetSaveInputs.mockReturnValue({
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
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
          compression: {
            method: 'auto',
            level: undefined,
          },
          ttlDays: 7,
          maxCacheSizeGb: 10,
        });

        mockStateProvider.getState.mockImplementation((key: string) => {
          if (key === State.CachePrimaryKey) return 'npm-abc123';
          if (key === State.CachePaths) return JSON.stringify(['/path/to/cache']);
          return '';
        });
        mockStateProvider.getCacheState.mockReturnValue(undefined);
        mockIsExactKeyMatch.mockReturnValue(false);
      });

      it('should handle save errors gracefully with Error instance', async () => {
        const error = new Error('Disk full');
        mockStorage.save.mockRejectedValue(error);

        const result = await saveCache(mockStateProvider);

        expect(result.saved).toBe(false);
        expect(result.key).toBe('npm-abc123');
        expect(mockCore.warning).toHaveBeenCalledWith(
          expect.stringContaining('Failed to save cache after restore: Disk full')
        );
        expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Key: npm-abc123'));
      });

      it('should handle save errors gracefully with non-Error value', async () => {
        mockStorage.save.mockRejectedValue('Unknown error');

        const result = await saveCache(mockStateProvider);

        expect(result.saved).toBe(false);
        expect(mockCore.warning).toHaveBeenCalledWith(
          expect.stringContaining('Failed to save cache after restore: Unknown error')
        );
      });
    });

    describe('storage provider configuration', () => {
      it('should create storage provider with correct config including compression', async () => {
        const mockInputs = {
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
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
          compression: {
            method: 'gzip' as const,
            level: 9,
          },
          ttlDays: 30,
          maxCacheSizeGb: 20,
        };

        const mockConfig = {
          type: 's3' as const,
          owner: 'test-owner',
          repo: 'test-repo',
          options: mockInputs.s3,
          compression: mockInputs.compression,
          ttlDays: 30,
          maxCacheSizeGb: 20,
        };

        mockGetSaveInputs.mockReturnValue(mockInputs);
        mockCreateSaveStorageConfig.mockReturnValue(mockConfig);
        mockStateProvider.getState.mockReturnValue('');
        mockStateProvider.getCacheState.mockReturnValue(undefined);
        mockIsExactKeyMatch.mockReturnValue(false);
        mockStorage.save.mockResolvedValue({
          key: 'npm-abc123',
          archivePath: '/archive/path',
          sizeBytes: 1024,
          createdAt: new Date().toISOString(),
        });

        await saveCache(mockStateProvider);

        expect(mockCreateSaveStorageConfig).toHaveBeenCalledWith(
          mockInputs,
          'test-owner',
          'test-repo'
        );
        expect(mockCreateStorageProvider).toHaveBeenCalledWith(mockConfig);
      });
    });

    describe('state handling', () => {
      beforeEach(() => {
        mockGetSaveInputs.mockReturnValue({
          key: 'npm-new-key',
          paths: ['/new/path'],
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
          compression: {
            method: 'auto',
            level: undefined,
          },
          ttlDays: 7,
          maxCacheSizeGb: 10,
        });

        mockIsExactKeyMatch.mockReturnValue(false);
        mockStorage.save.mockResolvedValue({
          key: 'npm-abc123',
          archivePath: '/archive/path',
          sizeBytes: 1024,
          createdAt: new Date().toISOString(),
        });
      });

      it('should use primary key from state over input key', async () => {
        mockStateProvider.getState.mockImplementation((key: string) => {
          if (key === State.CachePrimaryKey) return 'npm-state-key';
          if (key === State.CachePaths) return JSON.stringify(['/state/path']);
          return '';
        });
        mockStateProvider.getCacheState.mockReturnValue(undefined);

        await saveCache(mockStateProvider);

        expect(mockStorage.save).toHaveBeenCalledWith('npm-state-key', ['/state/path']);
      });

      it('should fallback to input key when state is empty', async () => {
        mockStateProvider.getState.mockReturnValue('');
        mockStateProvider.getCacheState.mockReturnValue(undefined);

        await saveCache(mockStateProvider);

        expect(mockStorage.save).toHaveBeenCalledWith('npm-new-key', ['/new/path']);
      });
    });
  });

  describe('saveCacheOnly', () => {
    beforeEach(() => {
      mockGetSaveInputs.mockReturnValue({
        key: 'npm-abc123',
        paths: ['/path/to/cache'],
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
        compression: {
          method: 'auto',
          level: undefined,
        },
        ttlDays: 7,
        maxCacheSizeGb: 10,
      });
    });

    describe('when save succeeds', () => {
      beforeEach(() => {
        mockStorage.save.mockResolvedValue({
          key: 'npm-abc123',
          archivePath: '/archive/path',
          sizeBytes: 1024,
          createdAt: new Date().toISOString(),
        });
      });

      it('should save cache successfully', async () => {
        const result = await saveCacheOnly();

        expect(result.saved).toBe(true);
        expect(result.key).toBe('npm-abc123');
        expect(mockStorage.save).toHaveBeenCalledWith('npm-abc123', ['/path/to/cache']);
      });

      it('should log save messages', async () => {
        await saveCacheOnly();

        expect(mockCore.info).toHaveBeenCalledWith('Saving cache for key: npm-abc123');
        expect(mockCore.info).toHaveBeenCalledWith('Storage provider: local');
        expect(mockCore.info).toHaveBeenCalledWith('Cache saved successfully for key: npm-abc123');
      });
    });

    describe('when save fails', () => {
      it('should handle save errors gracefully with Error instance', async () => {
        const error = new Error('Network timeout');
        mockStorage.save.mockRejectedValue(error);

        const result = await saveCacheOnly();

        expect(result.saved).toBe(false);
        expect(result.key).toBe('npm-abc123');
        expect(mockCore.warning).toHaveBeenCalledWith(
          expect.stringContaining('Failed to save cache: Network timeout')
        );
        expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Key: npm-abc123'));
        expect(mockCore.warning).toHaveBeenCalledWith(
          expect.stringContaining('Verify cache path is writable')
        );
      });

      it('should handle save errors gracefully with non-Error value', async () => {
        mockStorage.save.mockRejectedValue('String error');

        const result = await saveCacheOnly();

        expect(result.saved).toBe(false);
        expect(mockCore.warning).toHaveBeenCalledWith(
          expect.stringContaining('Failed to save cache: String error')
        );
      });
    });

    describe('storage provider configuration', () => {
      it('should create storage provider with GCS config', async () => {
        const mockInputs = {
          key: 'npm-abc123',
          paths: ['/path/to/cache'],
          storageProvider: 'gcs' as const,
          cachePath: '/tmp/cache',
          isExplicitCachePath: false,
          s3: {
            bucket: '',
            region: 'us-east-1',
            prefix: 'gha-cache/',
            forcePathStyle: false,
          },
          gcs: {
            bucket: 'my-gcs-bucket',
            projectId: 'my-project',
            keyFile: '/path/to/key.json',
            prefix: 'cache/',
          },
          compression: {
            method: 'zstd' as const,
            level: 5,
          },
          ttlDays: 14,
          maxCacheSizeGb: 15,
        };

        const mockConfig = {
          type: 'gcs' as const,
          owner: 'test-owner',
          repo: 'test-repo',
          options: mockInputs.gcs,
          compression: mockInputs.compression,
          ttlDays: 14,
          maxCacheSizeGb: 15,
        };

        mockGetSaveInputs.mockReturnValue(mockInputs);
        mockCreateSaveStorageConfig.mockReturnValue(mockConfig);
        mockStorage.save.mockResolvedValue({
          key: 'npm-abc123',
          archivePath: '/archive/path',
          sizeBytes: 1024,
          createdAt: new Date().toISOString(),
        });

        await saveCacheOnly();

        expect(mockCreateSaveStorageConfig).toHaveBeenCalledWith(
          mockInputs,
          'test-owner',
          'test-repo'
        );
        expect(mockCreateStorageProvider).toHaveBeenCalledWith(mockConfig);
      });
    });
  });
});
