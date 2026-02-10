import { S3IndexStore } from '../../../src/storage/s3/s3IndexStore';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');

describe('S3IndexStore', () => {
  let indexStore: S3IndexStore;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));

    indexStore = new S3IndexStore(
      {
        bucket: 'test-bucket',
        region: 'us-east-1',
        prefix: 'cache/',
      },
      'test-owner',
      'test-repo'
    );
  });

  describe('load', () => {
    it('returns empty index when object does not exist', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      noSuchKeyError.name = 'NoSuchKey';
      mockSend.mockRejectedValue(noSuchKeyError);

      const index = await indexStore.load();

      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('loads existing index', async () => {
      const testIndex = {
        version: '2',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2025-01-01T00:00:00.000Z',
            sizeBytes: 1000,
            accessedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      };

      mockSend.mockResolvedValue({
        ETag: '"abc123"',
        Body: Readable.from([Buffer.from(JSON.stringify(testIndex))]),
      });

      const index = await indexStore.load();

      expect(index).toEqual(testIndex);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('returns empty index when body is empty', async () => {
      mockSend.mockResolvedValue({
        ETag: '"abc123"',
        Body: null,
      });

      const index = await indexStore.load();

      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('migrates v1 index to v2', async () => {
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'old-key',
            archivePath: 'archives/old.tar.zst',
            createdAt: '2025-01-01T00:00:00.000Z',
            sizeBytes: 500,
          },
        ],
      };

      mockSend.mockResolvedValue({
        ETag: '"abc123"',
        Body: Readable.from([Buffer.from(JSON.stringify(v1Index))]),
      });

      const index = await indexStore.load();

      expect(index.version).toBe('2');
      expect(index.entries[0].accessedAt).toBe('2025-01-01T00:00:00.000Z');
    });

    it('returns empty index for unknown version', async () => {
      const futureIndex = {
        version: '99',
        entries: [],
      };

      mockSend.mockResolvedValue({
        ETag: '"abc123"',
        Body: Readable.from([Buffer.from(JSON.stringify(futureIndex))]),
      });

      const index = await indexStore.load();

      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('handles NotFound error', async () => {
      const notFoundError = new Error('NotFound');
      notFoundError.name = 'NotFound';
      mockSend.mockRejectedValue(notFoundError);

      const index = await indexStore.load();

      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('throws on other errors', async () => {
      const error = new Error('Network error');
      error.name = 'NetworkError';
      mockSend.mockRejectedValue(error);

      await expect(indexStore.load()).rejects.toThrow('Network error');
    });
  });

  describe('save', () => {
    it('saves index', async () => {
      mockSend.mockResolvedValue({});

      const testIndex = {
        version: '2',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2025-01-01T00:00:00.000Z',
            sizeBytes: 1000,
          },
        ],
      };

      await indexStore.save(testIndex);

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('uses conditional write when etag is available', async () => {
      // First load to get ETag
      mockSend.mockResolvedValueOnce({
        ETag: '"existing-etag"',
        Body: Readable.from([Buffer.from('{"version":"2","entries":[]}')]),
      });

      await indexStore.load();

      // Verify ETag was stored
      expect(indexStore.getETag()).toBe('"existing-etag"');

      // Now save
      mockSend.mockResolvedValueOnce({});

      await indexStore.save({ version: '2', entries: [] });

      // Verify save was called (second call after load)
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenLastCalledWith(expect.any(PutObjectCommand));
    });

    it('throws on precondition failed', async () => {
      // Load first to set ETag
      mockSend.mockResolvedValueOnce({
        ETag: '"old-etag"',
        Body: Readable.from([Buffer.from('{"version":"2","entries":[]}')]),
      });
      await indexStore.load();

      // Simulate precondition failed
      const preconditionError = new Error('PreconditionFailed');
      preconditionError.name = 'PreconditionFailed';
      mockSend.mockRejectedValueOnce(preconditionError);

      await expect(indexStore.save({ version: '2', entries: [] })).rejects.toThrow(
        'Index was modified by another process'
      );
    });

    it('throws on other errors', async () => {
      const error = new Error('Network error');
      error.name = 'NetworkError';
      mockSend.mockRejectedValue(error);

      await expect(indexStore.save({ version: '2', entries: [] })).rejects.toThrow('Network error');
    });
  });

  describe('getETag', () => {
    it('returns undefined initially', () => {
      expect(indexStore.getETag()).toBeUndefined();
    });

    it('returns ETag after load', async () => {
      mockSend.mockResolvedValue({
        ETag: '"test-etag"',
        Body: Readable.from([Buffer.from('{"version":"2","entries":[]}')]),
      });

      await indexStore.load();

      expect(indexStore.getETag()).toBe('"test-etag"');
    });
  });
});
