import { S3StorageProvider, createS3StorageProvider } from '../../../src/storage/s3/s3Provider';
import { createS3IndexStore } from '../../../src/storage/s3/s3IndexStore';
import { createS3StorageBackend } from '../../../src/storage/s3/s3Backend';

// Mock all S3 dependencies
jest.mock('../../../src/storage/s3/s3Backend', () => ({
  createS3StorageBackend: jest.fn(() => ({
    put: jest.fn().mockResolvedValue('archives/test.tar.zst'),
    get: jest.fn().mockResolvedValue(Buffer.from('test')),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    getSize: jest.fn().mockResolvedValue(1000),
    putFromPath: jest.fn().mockResolvedValue('archives/test.tar.zst'),
  })),
  S3StorageBackend: jest.fn(),
}));

jest.mock('../../../src/storage/s3/s3IndexStore', () => ({
  createS3IndexStore: jest.fn(() => ({
    load: jest.fn().mockResolvedValue({
      version: '2',
      entries: [
        {
          key: 'test-key',
          archivePath: 'archives/test.tar.zst',
          createdAt: new Date().toISOString(),
          sizeBytes: 1000,
          accessedAt: new Date().toISOString(),
        },
      ],
    }),
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../src/storage/s3/s3LockManager', () => ({
  createS3LockManager: jest.fn(() => ({
    withLock: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));

jest.mock('../../../src/archive/tar', () => ({
  createArchive: jest.fn().mockResolvedValue({
    archivePath: '/tmp/test.tar.zst',
    sizeBytes: 1000,
  }),
  extractArchive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@actions/io', () => ({
  rmRF: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdtemp: jest.fn().mockResolvedValue('/tmp/test-dir'),
  },
  writeFileSync: jest.fn(),
  rmSync: jest.fn(),
  mkdtempSync: jest.fn().mockReturnValue('/tmp/test-dir'),
}));

// Get mocked versions of the imports (cast to jest.Mock for flexibility with partial mocks)
const mockCreateS3IndexStore = createS3IndexStore as jest.Mock;
const mockCreateS3StorageBackend = createS3StorageBackend as jest.Mock;

describe('S3StorageProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createS3StorageProvider', () => {
    it('creates provider', () => {
      const provider = createS3StorageProvider(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      expect(provider).toBeInstanceOf(S3StorageProvider);
    });

    it('creates provider with options', () => {
      const provider = createS3StorageProvider(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo',
        { ttlDays: 7, maxCacheSizeGb: 5 }
      );

      expect(provider).toBeInstanceOf(S3StorageProvider);
    });
  });

  describe('resolve', () => {
    it('resolves exact match', async () => {
      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.resolve('test-key', []);

      expect(result.entry).toBeDefined();
      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('test-key');
    });

    it('resolves with restore keys', async () => {
      mockCreateS3IndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [
            {
              key: 'deps-abc123',
              archivePath: 'archives/test.tar.zst',
              createdAt: new Date().toISOString(),
              sizeBytes: 1000,
            },
          ],
        }),
        save: jest.fn().mockResolvedValue(undefined),
        getETag: jest.fn().mockReturnValue(undefined),
      });

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.resolve('deps-xyz', ['deps-']);

      expect(result.isExactMatch).toBe(false);
    });
  });

  describe('exists', () => {
    it('returns true for existing key', async () => {
      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.exists('test-key');

      expect(result).toBe(true);
    });

    it('returns false for missing key', async () => {
      mockCreateS3IndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
        getETag: jest.fn().mockReturnValue(undefined),
      });

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.exists('missing-key');

      expect(result).toBe(false);
    });
  });

  describe('getIndex', () => {
    it('returns current index', async () => {
      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const index = await provider.getIndex();

      expect(index.version).toBe('2');
      expect(index.entries).toHaveLength(1);
    });
  });

  describe('restore', () => {
    it('downloads and extracts archive', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockResolvedValue(Buffer.from('archive data')),
        put: jest.fn().mockResolvedValue('archives/test.tar.zst'),
        delete: jest.fn().mockResolvedValue(undefined),
        getSize: jest.fn().mockResolvedValue(1000),
        getStream: jest.fn(),
        putFromPath: jest.fn().mockResolvedValue('archives/test.tar.zst'),
      };
      mockCreateS3StorageBackend.mockReturnValueOnce(mockBackend);

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      await provider.restore({
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: new Date().toISOString(),
        sizeBytes: 1000,
      });

      expect(mockBackend.get).toHaveBeenCalled();
    });

    it('throws when archive not found', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(false),
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
        getSize: jest.fn(),
        getStream: jest.fn(),
        putFromPath: jest.fn(),
      };
      mockCreateS3StorageBackend.mockReturnValueOnce(mockBackend);

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      await expect(
        provider.restore({
          key: 'test-key',
          archivePath: 'archives/missing.tar.zst',
          createdAt: new Date().toISOString(),
          sizeBytes: 1000,
        })
      ).rejects.toThrow('Cache archive not found');
    });
  });

  describe('save', () => {
    it('creates and uploads archive', async () => {
      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
        getETag: jest.fn().mockReturnValue(undefined),
      };
      mockCreateS3IndexStore.mockReturnValueOnce(mockIndexStore);

      const mockBackend = {
        exists: jest.fn().mockResolvedValue(false),
        delete: jest.fn().mockResolvedValue(undefined),
        putFromPath: jest.fn().mockResolvedValue('archives/new.tar.zst'),
        get: jest.fn(),
        put: jest.fn(),
        getSize: jest.fn(),
        getStream: jest.fn(),
      };
      mockCreateS3StorageBackend.mockReturnValueOnce(mockBackend);

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = await provider.save('new-key', ['/path/to/file']);

      expect(entry.key).toBe('new-key');
      expect(mockBackend.putFromPath).toHaveBeenCalled();
      expect(mockIndexStore.save).toHaveBeenCalled();
    });

    it('skips save when entry exists', async () => {
      const existingEntry = {
        key: 'existing-key',
        archivePath: 'archives/existing.tar.zst',
        createdAt: new Date().toISOString(),
        sizeBytes: 1000,
      };
      mockCreateS3IndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [existingEntry],
        }),
        save: jest.fn().mockResolvedValue(undefined),
        getETag: jest.fn().mockReturnValue(undefined),
      });

      const provider = createS3StorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = await provider.save('existing-key', ['/path/to/file']);

      expect(entry).toEqual(existingEntry);
    });
  });
});
