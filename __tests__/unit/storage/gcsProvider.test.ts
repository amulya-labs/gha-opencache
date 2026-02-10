import { GCSStorageProvider, createGCSStorageProvider } from '../../../src/storage/gcs/gcsProvider';
import { createGCSIndexStore } from '../../../src/storage/gcs/gcsIndexStore';
import { createGCSStorageBackend } from '../../../src/storage/gcs/gcsBackend';

// Mock all GCS dependencies
jest.mock('../../../src/storage/gcs/gcsBackend', () => ({
  createGCSStorageBackend: jest.fn(() => ({
    put: jest.fn().mockResolvedValue('archives/test.tar.zst'),
    get: jest.fn().mockResolvedValue(Buffer.from('test')),
    delete: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
    getSize: jest.fn().mockResolvedValue(1000),
    putFromPath: jest.fn().mockResolvedValue('archives/test.tar.zst'),
  })),
  GCSStorageBackend: jest.fn(),
}));

jest.mock('../../../src/storage/gcs/gcsIndexStore', () => ({
  createGCSIndexStore: jest.fn(() => ({
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

jest.mock('../../../src/storage/gcs/gcsLockManager', () => ({
  createGCSLockManager: jest.fn(() => ({
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

// Get mocked versions of the imports
const mockCreateGCSIndexStore = createGCSIndexStore as jest.Mock;
const mockCreateGCSStorageBackend = createGCSStorageBackend as jest.Mock;

describe('GCSStorageProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createGCSStorageProvider', () => {
    it('creates provider', () => {
      const provider = createGCSStorageProvider(
        { bucket: 'test-bucket', projectId: 'test-project' },
        'owner',
        'repo'
      );

      expect(provider).toBeInstanceOf(GCSStorageProvider);
    });

    it('creates provider with options', () => {
      const provider = createGCSStorageProvider(
        { bucket: 'test-bucket', projectId: 'test-project' },
        'owner',
        'repo',
        { ttlDays: 7, maxCacheSizeGb: 5 }
      );

      expect(provider).toBeInstanceOf(GCSStorageProvider);
    });

    it('creates provider with keyFilename', () => {
      const provider = createGCSStorageProvider(
        { bucket: 'test-bucket', keyFilename: '/path/to/key.json' },
        'owner',
        'repo'
      );

      expect(provider).toBeInstanceOf(GCSStorageProvider);
    });

    it('creates provider with credentials object', () => {
      const provider = createGCSStorageProvider(
        {
          bucket: 'test-bucket',
          credentials: { client_email: 'test@example.com', private_key: 'key' },
        },
        'owner',
        'repo'
      );

      expect(provider).toBeInstanceOf(GCSStorageProvider);
    });
  });

  describe('resolve', () => {
    it('resolves exact match', async () => {
      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.resolve('test-key', []);

      expect(result.entry).toBeDefined();
      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('test-key');
    });

    it('resolves with restore keys', async () => {
      mockCreateGCSIndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [
            {
              key: 'deps-abc123',
              archivePath: 'archives/test.tar.zst',
              createdAt: new Date().toISOString(),
              sizeBytes: 1000,
              accessedAt: new Date().toISOString(),
            },
          ],
        }),
        save: jest.fn().mockResolvedValue(undefined),
        getGeneration: jest.fn().mockReturnValue(undefined),
      });

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.resolve('deps-xyz', ['deps-']);

      expect(result.isExactMatch).toBe(false);
    });
  });

  describe('exists', () => {
    it('returns true for existing key', async () => {
      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.exists('test-key');

      expect(result).toBe(true);
    });

    it('returns false for missing key', async () => {
      mockCreateGCSIndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
        getGeneration: jest.fn().mockReturnValue(undefined),
      });

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const result = await provider.exists('missing-key');

      expect(result).toBe(false);
    });
  });

  describe('restore', () => {
    it('restores cache entry', async () => {
      const backend = mockCreateGCSStorageBackend();
      backend.get = jest.fn().mockResolvedValue(Buffer.from('archive data'));
      backend.exists = jest.fn().mockResolvedValue(true);
      mockCreateGCSStorageBackend.mockReturnValue(backend);

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: new Date().toISOString(),
        sizeBytes: 1000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        accessedAt: new Date().toISOString(),
      };

      await provider.restore(entry);

      expect(backend.exists).toHaveBeenCalledWith('archives/test.tar.zst');
      expect(backend.get).toHaveBeenCalledWith('archives/test.tar.zst');
    });

    it('throws error when archive does not exist', async () => {
      const backend = mockCreateGCSStorageBackend();
      backend.exists = jest.fn().mockResolvedValue(false);
      mockCreateGCSStorageBackend.mockReturnValue(backend);

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = {
        key: 'test-key',
        archivePath: 'archives/missing.tar.zst',
        createdAt: new Date().toISOString(),
        sizeBytes: 1000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        accessedAt: new Date().toISOString(),
      };

      await expect(provider.restore(entry)).rejects.toThrow('Cache archive not found');
    });
  });

  describe('save', () => {
    it('saves cache entry', async () => {
      const backend = mockCreateGCSStorageBackend();
      backend.putFromPath = jest.fn().mockResolvedValue('archives/new.tar.zst');
      mockCreateGCSStorageBackend.mockReturnValue(backend);

      mockCreateGCSIndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
        getGeneration: jest.fn().mockReturnValue(undefined),
      });

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = await provider.save('new-key', ['path1', 'path2']);

      expect(entry.key).toBe('new-key');
      expect(entry.archivePath).toBe('archives/new.tar.zst');
    });

    it('returns existing entry if already cached', async () => {
      mockCreateGCSIndexStore.mockReturnValueOnce({
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [
            {
              key: 'existing-key',
              archivePath: 'archives/existing.tar.zst',
              createdAt: new Date().toISOString(),
              sizeBytes: 1000,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              accessedAt: new Date().toISOString(),
            },
          ],
        }),
        save: jest.fn().mockResolvedValue(undefined),
        getGeneration: jest.fn().mockReturnValue(undefined),
      });

      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const entry = await provider.save('existing-key', ['path1']);

      expect(entry.key).toBe('existing-key');
      expect(entry.archivePath).toBe('archives/existing.tar.zst');
    });
  });

  describe('getIndex', () => {
    it('returns cache index', async () => {
      const provider = createGCSStorageProvider({ bucket: 'test-bucket' }, 'owner', 'repo');

      const index = await provider.getIndex();

      expect(index.version).toBe('2');
      expect(index.entries).toHaveLength(1);
    });
  });
});
