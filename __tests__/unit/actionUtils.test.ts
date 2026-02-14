import * as core from '@actions/core';
import {
  isExactKeyMatch,
  getRepoInfo,
  getInputs,
  getRestoreInputs,
  getSaveInputs,
  createRestoreStorageConfig,
  createSaveStorageConfig,
} from '../../src/utils/actionUtils';
import {
  Inputs,
  DEFAULT_COMPRESSION,
  DEFAULT_TTL_DAYS,
  DEFAULT_MAX_CACHE_SIZE_GB,
  getDefaultCachePath,
} from '../../src/constants';

jest.mock('@actions/core');

describe('actionUtils', () => {
  const mockCore = core as jest.Mocked<typeof core>;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isExactKeyMatch', () => {
    it('returns true when keys match exactly', () => {
      expect(isExactKeyMatch('npm-abc123', 'npm-abc123')).toBe(true);
    });

    it('returns false when keys differ', () => {
      expect(isExactKeyMatch('npm-abc123', 'npm-xyz789')).toBe(false);
    });

    it('returns false when matchedKey is undefined', () => {
      expect(isExactKeyMatch('npm-abc123', undefined)).toBe(false);
    });
  });

  describe('getRepoInfo', () => {
    it('extracts owner and repo from GITHUB_REPOSITORY', () => {
      process.env.GITHUB_REPOSITORY = 'my-org/my-repo';

      const { owner, repo } = getRepoInfo();

      expect(owner).toBe('my-org');
      expect(repo).toBe('my-repo');
    });

    it('throws when GITHUB_REPOSITORY is not set', () => {
      delete process.env.GITHUB_REPOSITORY;

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });

    it('throws when GITHUB_REPOSITORY format is invalid', () => {
      process.env.GITHUB_REPOSITORY = 'invalid-format';

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });

    it('throws when GITHUB_REPOSITORY has empty owner', () => {
      process.env.GITHUB_REPOSITORY = '/my-repo';

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });

    it('throws when GITHUB_REPOSITORY has empty repo', () => {
      process.env.GITHUB_REPOSITORY = 'my-org/';

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });
  });

  describe('getInputs', () => {
    beforeEach(() => {
      process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
      mockCore.getInput.mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          [Inputs.Key]: 'npm-abc123',
          [Inputs.Path]: '/path/to/cache',
          [Inputs.RestoreKeys]: '',
          [Inputs.StorageProvider]: 'local',
          [Inputs.CachePath]: '',
          [Inputs.S3Bucket]: '',
          [Inputs.S3Region]: '',
          [Inputs.S3Endpoint]: '',
          [Inputs.S3Prefix]: '',
          [Inputs.S3ForcePathStyle]: '',
          [Inputs.GCSBucket]: '',
          [Inputs.GCSProject]: '',
          [Inputs.GCSKeyFile]: '',
          [Inputs.GCSPrefix]: '',
          [Inputs.Compression]: '',
          [Inputs.CompressionLevel]: '',
          [Inputs.TtlDays]: '',
          [Inputs.MaxCacheSizeGb]: '',
        };
        return inputs[name] || '';
      });
      mockCore.getBooleanInput.mockReturnValue(false);
    });

    it('should parse basic inputs correctly', () => {
      const inputs = getInputs();

      expect(inputs.key).toBe('npm-abc123');
      expect(inputs.paths).toEqual(['/path/to/cache']);
      expect(inputs.restoreKeys).toEqual([]);
      expect(inputs.storageProvider).toBe('local');
    });

    it('should parse multiple paths', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Path) return '/path1\n/path2\n/path3';
        if (name === Inputs.Key) return 'key';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.paths).toEqual(['/path1', '/path2', '/path3']);
    });

    it('should filter empty paths', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Path) return '/path1\n\n/path2\n';
        if (name === Inputs.Key) return 'key';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.paths).toEqual(['/path1', '/path2']);
    });

    it('should parse restore keys', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.RestoreKeys) return 'npm-\nnode-';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.restoreKeys).toEqual(['npm-', 'node-']);
    });

    it('should parse boolean inputs', () => {
      mockCore.getBooleanInput.mockImplementation((name: string) => {
        if (name === Inputs.FailOnCacheMiss) return true;
        if (name === Inputs.LookupOnly) return true;
        if (name === Inputs.SaveAlways) return true;
        return false;
      });

      const inputs = getInputs();

      expect(inputs.failOnCacheMiss).toBe(true);
      expect(inputs.lookupOnly).toBe(true);
      expect(inputs.saveAlways).toBe(true);
    });

    it('should use default cache path when not specified', () => {
      const inputs = getInputs();

      expect(inputs.cachePath).toBe(getDefaultCachePath());
      expect(inputs.isExplicitCachePath).toBe(false);
    });

    it('should use explicit cache path when specified', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.CachePath) return '/custom/cache';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.cachePath).toBe('/custom/cache');
      expect(inputs.isExplicitCachePath).toBe(true);
    });

    it('should parse S3 inputs', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.S3Bucket) return 'my-bucket';
        if (name === Inputs.S3Region) return 'us-west-2';
        if (name === Inputs.S3Endpoint) return 'https://s3.example.com';
        if (name === Inputs.S3Prefix) return 'cache/';
        if (name === Inputs.S3ForcePathStyle) return 'true';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        if (name === Inputs.StorageProvider) return 's3';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.s3.bucket).toBe('my-bucket');
      expect(inputs.s3.region).toBe('us-west-2');
      expect(inputs.s3.endpoint).toBe('https://s3.example.com');
      expect(inputs.s3.prefix).toBe('cache/');
      expect(inputs.s3.forcePathStyle).toBe(true);
    });

    it('should use default S3 values', () => {
      const inputs = getInputs();

      expect(inputs.s3.bucket).toBe('');
      expect(inputs.s3.region).toBe('us-east-1');
      expect(inputs.s3.prefix).toBe('gha-cache/');
      expect(inputs.s3.forcePathStyle).toBe(false);
    });

    it('should parse GCS inputs', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.GCSBucket) return 'my-gcs-bucket';
        if (name === Inputs.GCSProject) return 'my-project';
        if (name === Inputs.GCSKeyFile) return '/path/to/key.json';
        if (name === Inputs.GCSPrefix) return 'cache/';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        if (name === Inputs.StorageProvider) return 'gcs';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.gcs.bucket).toBe('my-gcs-bucket');
      expect(inputs.gcs.projectId).toBe('my-project');
      expect(inputs.gcs.keyFile).toBe('/path/to/key.json');
      expect(inputs.gcs.prefix).toBe('cache/');
    });

    it('should use default GCS values', () => {
      const inputs = getInputs();

      expect(inputs.gcs.bucket).toBe('');
      expect(inputs.gcs.projectId).toBeUndefined();
      expect(inputs.gcs.keyFile).toBeUndefined();
      expect(inputs.gcs.prefix).toBe('gha-cache/');
    });

    it('should parse compression options', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Compression) return 'zstd';
        if (name === Inputs.CompressionLevel) return '5';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.compression.method).toBe('zstd');
      expect(inputs.compression.level).toBe(5);
    });

    it('should use default compression when not specified', () => {
      const inputs = getInputs();

      expect(inputs.compression.method).toBe(DEFAULT_COMPRESSION);
      expect(inputs.compression.level).toBeUndefined();
    });

    it('should warn on invalid compression method', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Compression) return 'invalid';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.compression.method).toBe('auto');
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid compression method')
      );
    });

    it('should warn on invalid compression level', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.CompressionLevel) return 'not-a-number';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.compression.level).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid compression level')
      );
    });

    it('should parse TTL days', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.TtlDays) return '30';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.ttlDays).toBe(30);
    });

    it('should use default TTL when not specified', () => {
      const inputs = getInputs();

      expect(inputs.ttlDays).toBe(DEFAULT_TTL_DAYS);
    });

    it('should warn on invalid TTL days', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.TtlDays) return 'invalid';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.ttlDays).toBe(DEFAULT_TTL_DAYS);
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Invalid ttl-days'));
    });

    it('should warn on negative TTL days', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.TtlDays) return '-5';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.ttlDays).toBe(DEFAULT_TTL_DAYS);
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Invalid ttl-days'));
    });

    it('should parse max cache size', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.MaxCacheSizeGb) return '20.5';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.maxCacheSizeGb).toBe(20.5);
    });

    it('should use default max cache size when not specified', () => {
      const inputs = getInputs();

      expect(inputs.maxCacheSizeGb).toBe(DEFAULT_MAX_CACHE_SIZE_GB);
    });

    it('should warn on invalid max cache size', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.MaxCacheSizeGb) return 'invalid';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.maxCacheSizeGb).toBe(DEFAULT_MAX_CACHE_SIZE_GB);
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid max-cache-size-gb')
      );
    });

    it('should warn on negative max cache size', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.MaxCacheSizeGb) return '-10';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.maxCacheSizeGb).toBe(DEFAULT_MAX_CACHE_SIZE_GB);
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid max-cache-size-gb')
      );
    });

    it('should throw when S3 provider selected but bucket not specified', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.StorageProvider) return 's3';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      expect(() => getInputs()).toThrow('s3-bucket is required when using s3 storage provider');
    });

    it('should throw when GCS provider selected but bucket not specified', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.StorageProvider) return 'gcs';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      expect(() => getInputs()).toThrow('gcs-bucket is required when using gcs storage provider');
    });

    it('should warn on invalid storage provider', () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.StorageProvider) return 'invalid';
        if (name === Inputs.Key) return 'key';
        if (name === Inputs.Path) return '/path';
        return '';
      });

      const inputs = getInputs();

      expect(inputs.storageProvider).toBe('local');
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid storage-provider')
      );
    });
  });

  describe('getRestoreInputs', () => {
    beforeEach(() => {
      process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Key) return 'npm-abc123';
        if (name === Inputs.Path) return '/path';
        return '';
      });
      mockCore.getBooleanInput.mockReturnValue(false);
    });

    it('should return only restore-specific inputs', () => {
      const inputs = getRestoreInputs();

      expect(inputs).toHaveProperty('key');
      expect(inputs).toHaveProperty('paths');
      expect(inputs).toHaveProperty('restoreKeys');
      expect(inputs).toHaveProperty('failOnCacheMiss');
      expect(inputs).toHaveProperty('lookupOnly');
      expect(inputs).toHaveProperty('storageProvider');
      expect(inputs).not.toHaveProperty('saveAlways');
      expect(inputs).not.toHaveProperty('compression');
      expect(inputs).not.toHaveProperty('ttlDays');
    });
  });

  describe('getSaveInputs', () => {
    beforeEach(() => {
      process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === Inputs.Key) return 'npm-abc123';
        if (name === Inputs.Path) return '/path';
        return '';
      });
      mockCore.getBooleanInput.mockReturnValue(false);
    });

    it('should return only save-specific inputs', () => {
      const inputs = getSaveInputs();

      expect(inputs).toHaveProperty('key');
      expect(inputs).toHaveProperty('paths');
      expect(inputs).toHaveProperty('storageProvider');
      expect(inputs).toHaveProperty('compression');
      expect(inputs).toHaveProperty('ttlDays');
      expect(inputs).toHaveProperty('maxCacheSizeGb');
      expect(inputs).not.toHaveProperty('restoreKeys');
      expect(inputs).not.toHaveProperty('failOnCacheMiss');
      expect(inputs).not.toHaveProperty('lookupOnly');
    });
  });

  describe('createRestoreStorageConfig', () => {
    const mockInputs = {
      key: 'npm-abc123',
      paths: ['/path'],
      restoreKeys: [],
      failOnCacheMiss: false,
      lookupOnly: false,
      storageProvider: 'local' as const,
      cachePath: '/cache',
      isExplicitCachePath: false,
      s3: { bucket: '', region: 'us-east-1', prefix: 'gha-cache/', forcePathStyle: false },
      gcs: { bucket: '', prefix: 'gha-cache/' },
    };

    it('should create local storage config', () => {
      const config = createRestoreStorageConfig(mockInputs, 'owner', 'repo');

      expect(config.type).toBe('local');
      expect(config.owner).toBe('owner');
      expect(config.repo).toBe('repo');
      expect(config.options).toEqual({ basePath: '/cache' });
    });

    it('should create S3 storage config', () => {
      const s3Inputs = {
        ...mockInputs,
        storageProvider: 's3' as const,
        s3: {
          bucket: 'my-bucket',
          region: 'us-west-2',
          endpoint: 'https://s3.example.com',
          prefix: 'cache/',
          forcePathStyle: true,
        },
      };

      const config = createRestoreStorageConfig(s3Inputs, 'owner', 'repo');

      expect(config.type).toBe('s3');
      expect(config.owner).toBe('owner');
      expect(config.repo).toBe('repo');
      expect(config.options).toEqual(s3Inputs.s3);
    });

    it('should create GCS storage config', () => {
      const gcsInputs = {
        ...mockInputs,
        storageProvider: 'gcs' as const,
        gcs: {
          bucket: 'my-bucket',
          projectId: 'my-project',
          keyFile: '/key.json',
          prefix: 'cache/',
        },
      };

      const config = createRestoreStorageConfig(gcsInputs, 'owner', 'repo');

      expect(config.type).toBe('gcs');
      expect(config.owner).toBe('owner');
      expect(config.repo).toBe('repo');
      expect(config.options).toEqual({
        bucket: 'my-bucket',
        projectId: 'my-project',
        keyFilename: '/key.json',
        prefix: 'cache/',
      });
    });
  });

  describe('createSaveStorageConfig', () => {
    const mockInputs = {
      key: 'npm-abc123',
      paths: ['/path'],
      storageProvider: 'local' as const,
      cachePath: '/cache',
      isExplicitCachePath: false,
      s3: { bucket: '', region: 'us-east-1', prefix: 'gha-cache/', forcePathStyle: false },
      gcs: { bucket: '', prefix: 'gha-cache/' },
      compression: { method: 'zstd' as const, level: 3 },
      ttlDays: 7,
      maxCacheSizeGb: 10,
    };

    it('should create local storage config with compression settings', () => {
      const config = createSaveStorageConfig(mockInputs, 'owner', 'repo');

      expect(config.type).toBe('local');
      expect(config.owner).toBe('owner');
      expect(config.repo).toBe('repo');
      expect(config.options).toEqual({ basePath: '/cache' });
      expect(config.compression).toEqual({ method: 'zstd', level: 3 });
      expect(config.ttlDays).toBe(7);
      expect(config.maxCacheSizeGb).toBe(10);
    });

    it('should create S3 storage config with compression settings', () => {
      const s3Inputs = {
        ...mockInputs,
        storageProvider: 's3' as const,
        s3: {
          bucket: 'my-bucket',
          region: 'us-west-2',
          prefix: 'cache/',
          forcePathStyle: false,
        },
        compression: { method: 'gzip' as const, level: 9 },
        ttlDays: 30,
        maxCacheSizeGb: 20,
      };

      const config = createSaveStorageConfig(s3Inputs, 'owner', 'repo');

      expect(config.type).toBe('s3');
      expect(config.options).toEqual(s3Inputs.s3);
      expect(config.compression).toEqual({ method: 'gzip', level: 9 });
      expect(config.ttlDays).toBe(30);
      expect(config.maxCacheSizeGb).toBe(20);
    });

    it('should create GCS storage config with compression settings', () => {
      const gcsInputs = {
        ...mockInputs,
        storageProvider: 'gcs' as const,
        gcs: {
          bucket: 'my-bucket',
          projectId: 'my-project',
          keyFile: '/key.json',
          prefix: 'cache/',
        },
        compression: { method: 'none' as const, level: undefined },
        ttlDays: 14,
        maxCacheSizeGb: 15,
      };

      const config = createSaveStorageConfig(gcsInputs, 'owner', 'repo');

      expect(config.type).toBe('gcs');
      expect(config.options).toEqual({
        bucket: 'my-bucket',
        projectId: 'my-project',
        keyFilename: '/key.json',
        prefix: 'cache/',
      });
      expect(config.compression).toEqual({ method: 'none', level: undefined });
      expect(config.ttlDays).toBe(14);
      expect(config.maxCacheSizeGb).toBe(15);
    });
  });
});
