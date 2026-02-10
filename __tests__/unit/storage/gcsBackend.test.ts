import { GCSStorageBackend } from '../../../src/storage/gcs/gcsBackend';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';
import * as fs from 'fs';

// Mock GCS SDK
jest.mock('@google-cloud/storage');

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('file content')),
}));

describe('GCSStorageBackend', () => {
  let backend: GCSStorageBackend;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBucket: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFile: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockFile = {
      save: jest.fn().mockResolvedValue(undefined),
      download: jest.fn().mockResolvedValue([Buffer.from('test data')]),
      createReadStream: jest.fn().mockReturnValue(Readable.from(['test stream'])),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue([true]),
      getMetadata: jest.fn().mockResolvedValue([{ size: '1024' }]),
    };

    mockBucket = {
      file: jest.fn().mockReturnValue(mockFile),
    };

    (Storage as unknown as jest.Mock).mockImplementation(() => ({
      bucket: jest.fn().mockReturnValue(mockBucket),
    }));

    backend = new GCSStorageBackend({
      bucket: 'test-bucket',
      prefix: 'cache/',
    });
  });

  describe('constructor', () => {
    it('creates client with default config (ADC)', () => {
      new GCSStorageBackend({
        bucket: 'test-bucket',
      });

      expect(Storage).toHaveBeenCalledWith({});
    });

    it('creates client with projectId', () => {
      new GCSStorageBackend({
        bucket: 'test-bucket',
        projectId: 'my-project',
      });

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
        })
      );
    });

    it('creates client with keyFilename', () => {
      new GCSStorageBackend({
        bucket: 'test-bucket',
        keyFilename: '/path/to/key.json',
      });

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          keyFilename: '/path/to/key.json',
        })
      );
    });

    it('creates client with credentials object', () => {
      new GCSStorageBackend({
        bucket: 'test-bucket',
        credentials: {
          client_email: 'test@example.com',
          private_key: 'test-key',
        },
      });

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            client_email: 'test@example.com',
            private_key: 'test-key',
          },
        })
      );
    });
  });

  describe('put', () => {
    it('uploads buffer data with non-resumable upload', async () => {
      const testData = Buffer.from('test content');

      const location = await backend.put('test-key', testData);

      expect(location).toMatch(/^archives\/sha256-[a-f0-9]+\.tar\.zst$/);
      expect(mockFile.save).toHaveBeenCalledWith(testData, {
        resumable: false,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    });

    it('uploads large buffer with resumable upload', async () => {
      const largeData = Buffer.alloc(6 * 1024 * 1024); // 6MB

      await backend.put('test-key', largeData);

      expect(mockFile.save).toHaveBeenCalledWith(largeData, {
        resumable: true,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    });

    it('uploads stream data', async () => {
      const stream = Readable.from(['chunk1', 'chunk2']);

      const location = await backend.put('test-key', stream);

      expect(location).toMatch(/^archives\/sha256-[a-f0-9]+\.tar\.zst$/);
      expect(mockFile.save).toHaveBeenCalled();
    });
  });

  describe('putFromPath', () => {
    it('uploads file from path', async () => {
      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(Buffer.from('file content'));

      const location = await backend.putFromPath('/tmp/sha256-abc123.tar.zst');

      expect(location).toBe('archives/sha256-abc123.tar.zst');
      expect(mockFile.save).toHaveBeenCalled();
    });

    it('uses resumable upload for large files', async () => {
      const largeData = Buffer.alloc(6 * 1024 * 1024); // 6MB
      const mockReadFileSync = fs.readFileSync as jest.Mock;
      mockReadFileSync.mockReturnValue(largeData);

      await backend.putFromPath('/tmp/sha256-abc123.tar.zst');

      expect(mockFile.save).toHaveBeenCalledWith(largeData, {
        resumable: true,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    });
  });

  describe('get', () => {
    it('downloads file as buffer', async () => {
      mockFile.download.mockResolvedValue([Buffer.from('test data')]);

      const data = await backend.get('archives/sha256-abc123.tar.zst');

      expect(data).toEqual(Buffer.from('test data'));
      expect(mockBucket.file).toHaveBeenCalledWith('cache/archives/sha256-abc123.tar.zst');
      expect(mockFile.download).toHaveBeenCalled();
    });
  });

  describe('getStream', () => {
    it('returns readable stream', async () => {
      const stream = await backend.getStream('archives/sha256-abc123.tar.zst');

      expect(stream).toBeInstanceOf(Readable);
      expect(mockBucket.file).toHaveBeenCalledWith('cache/archives/sha256-abc123.tar.zst');
      expect(mockFile.createReadStream).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes file', async () => {
      await backend.delete('archives/sha256-abc123.tar.zst');

      expect(mockBucket.file).toHaveBeenCalledWith('cache/archives/sha256-abc123.tar.zst');
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });
  });

  describe('exists', () => {
    it('returns true when file exists', async () => {
      mockFile.exists.mockResolvedValue([true]);

      const exists = await backend.exists('archives/sha256-abc123.tar.zst');

      expect(exists).toBe(true);
      expect(mockFile.exists).toHaveBeenCalled();
    });

    it('returns false when file does not exist', async () => {
      mockFile.exists.mockResolvedValue([false]);

      const exists = await backend.exists('archives/sha256-abc123.tar.zst');

      expect(exists).toBe(false);
    });

    it('returns false on error', async () => {
      mockFile.exists.mockRejectedValue(new Error('Network error'));

      const exists = await backend.exists('archives/sha256-abc123.tar.zst');

      expect(exists).toBe(false);
    });
  });

  describe('getSize', () => {
    it('returns file size', async () => {
      mockFile.getMetadata.mockResolvedValue([{ size: '2048' }]);

      const size = await backend.getSize('archives/sha256-abc123.tar.zst');

      expect(size).toBe(2048);
      expect(mockFile.getMetadata).toHaveBeenCalled();
    });

    it('returns 0 when size is missing', async () => {
      mockFile.getMetadata.mockResolvedValue([{}]);

      const size = await backend.getSize('archives/sha256-abc123.tar.zst');

      expect(size).toBe(0);
    });
  });
});
