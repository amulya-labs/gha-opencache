import { GCSIndexStore } from '../../../src/storage/gcs/gcsIndexStore';
import { Storage } from '@google-cloud/storage';
import { INDEX_VERSION } from '../../../src/constants';

// Mock GCS SDK
jest.mock('@google-cloud/storage');

describe('GCSIndexStore', () => {
  let store: GCSIndexStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBucket: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFile = {
      exists: jest.fn(),
      getMetadata: jest.fn(),
      download: jest.fn(),
      save: jest.fn(),
    };

    mockBucket = {
      file: jest.fn().mockReturnValue(mockFile),
    };

    (Storage as unknown as jest.Mock).mockImplementation(() => ({
      bucket: jest.fn().mockReturnValue(mockBucket),
    }));

    store = new GCSIndexStore(
      {
        bucket: 'test-bucket',
        prefix: 'cache/',
      },
      'owner',
      'repo'
    );
  });

  describe('load', () => {
    it('returns empty index when file does not exist', async () => {
      mockFile.exists.mockResolvedValue([false]);

      const index = await store.load();

      expect(index).toEqual({
        version: INDEX_VERSION,
        entries: [],
      });
    });

    it('loads existing index', async () => {
      const mockIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/sha256-abc.tar.zst',
            createdAt: '2024-01-01T00:00:00Z',
            sizeBytes: 1024,
            expiresAt: '2024-02-01T00:00:00Z',
            accessedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([{ generation: '123' }]);
      mockFile.download.mockResolvedValue([Buffer.from(JSON.stringify(mockIndex))]);

      const index = await store.load();

      expect(index).toEqual(mockIndex);
      expect(store.getGeneration()).toBe(123);
    });

    it('migrates v1 index to v2', async () => {
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/sha256-abc.tar.zst',
            createdAt: '2024-01-01T00:00:00Z',
            sizeBytes: 1024,
            expiresAt: '2024-02-01T00:00:00Z',
          },
        ],
      };

      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([{ generation: '123' }]);
      mockFile.download.mockResolvedValue([Buffer.from(JSON.stringify(v1Index))]);

      const index = await store.load();

      expect(index.version).toBe(INDEX_VERSION);
      expect(index.entries[0].accessedAt).toBe(v1Index.entries[0].createdAt);
    });

    it('returns empty index for unknown version', async () => {
      const unknownIndex = {
        version: '999',
        entries: [],
      };

      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([{ generation: '123' }]);
      mockFile.download.mockResolvedValue([Buffer.from(JSON.stringify(unknownIndex))]);

      const index = await store.load();

      expect(index).toEqual({
        version: INDEX_VERSION,
        entries: [],
      });
    });

    it('handles missing index file error', async () => {
      mockFile.exists.mockRejectedValue(new Error('No such object'));

      const index = await store.load();

      expect(index).toEqual({
        version: INDEX_VERSION,
        entries: [],
      });
    });
  });

  describe('save', () => {
    beforeEach(async () => {
      // Load to set initial generation
      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([{ generation: '100' }]);
      mockFile.download.mockResolvedValue([
        Buffer.from(
          JSON.stringify({
            version: INDEX_VERSION,
            entries: [],
          })
        ),
      ]);
      await store.load();
    });

    it('saves index with generation matching', async () => {
      const index = {
        version: INDEX_VERSION,
        entries: [],
      };

      mockFile.getMetadata.mockResolvedValue([{ generation: '101' }]);
      await store.save(index);

      expect(mockFile.save).toHaveBeenCalledWith(JSON.stringify(index, null, 2), {
        metadata: {
          contentType: 'application/json',
        },
        preconditionOpts: {
          ifGenerationMatch: 100,
        },
      });
      expect(store.getGeneration()).toBe(101);
    });

    it('saves index without generation when not loaded', async () => {
      const freshStore = new GCSIndexStore(
        {
          bucket: 'test-bucket',
          prefix: 'cache/',
        },
        'owner',
        'repo'
      );

      const index = {
        version: INDEX_VERSION,
        entries: [],
      };

      mockFile.getMetadata.mockResolvedValue([{ generation: '1' }]);
      await freshStore.save(index);

      expect(mockFile.save).toHaveBeenCalledWith(JSON.stringify(index, null, 2), {
        metadata: {
          contentType: 'application/json',
        },
      });
    });

    it('throws error on generation mismatch', async () => {
      const index = {
        version: INDEX_VERSION,
        entries: [],
      };

      mockFile.save.mockRejectedValue(new Error('conditionNotMet'));

      await expect(store.save(index)).rejects.toThrow(
        'Index was modified by another process. Please retry the operation.'
      );
    });

    it('propagates other errors', async () => {
      const index = {
        version: INDEX_VERSION,
        entries: [],
      };

      mockFile.save.mockRejectedValue(new Error('Network error'));

      await expect(store.save(index)).rejects.toThrow('Network error');
    });
  });

  describe('getGeneration', () => {
    it('returns undefined before loading', () => {
      expect(store.getGeneration()).toBeUndefined();
    });

    it('returns generation after loading', async () => {
      mockFile.exists.mockResolvedValue([true]);
      mockFile.getMetadata.mockResolvedValue([{ generation: '456' }]);
      mockFile.download.mockResolvedValue([
        Buffer.from(
          JSON.stringify({
            version: INDEX_VERSION,
            entries: [],
          })
        ),
      ]);

      await store.load();

      expect(store.getGeneration()).toBe(456);
    });
  });
});
