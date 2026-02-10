import { S3StorageBackend } from '../../../src/storage/s3/s3Backend';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: jest.fn().mockResolvedValue({}),
  })),
}));

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue(Buffer.from('file content')),
}));

describe('S3StorageBackend', () => {
  let backend: S3StorageBackend;
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));

    backend = new S3StorageBackend({
      bucket: 'test-bucket',
      region: 'us-east-1',
      prefix: 'cache/',
    });
  });

  describe('constructor', () => {
    it('creates client with region', () => {
      new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'eu-west-1',
      });

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'eu-west-1',
        })
      );
    });

    it('creates client with custom endpoint', () => {
      new S3StorageBackend({
        bucket: 'test-bucket',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
      });

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
        })
      );
    });

    it('creates client with explicit credentials', () => {
      new S3StorageBackend({
        bucket: 'test-bucket',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret123',
      });

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            accessKeyId: 'AKIATEST',
            secretAccessKey: 'secret123',
          },
        })
      );
    });
  });

  describe('put', () => {
    it('uploads buffer data', async () => {
      const testData = Buffer.from('test content');
      mockSend.mockResolvedValue({});

      const location = await backend.put('test-key', testData);

      expect(location).toMatch(/^archives\/sha256-[a-f0-9]+\.tar\.zst$/);
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });

    it('uploads readable stream', async () => {
      const stream = Readable.from([Buffer.from('test'), Buffer.from(' content')]);
      mockSend.mockResolvedValue({});

      const location = await backend.put('test-key', stream);

      expect(location).toMatch(/^archives\/sha256-[a-f0-9]+\.tar\.zst$/);
    });
  });

  describe('get', () => {
    it('retrieves data as buffer', async () => {
      const testData = Buffer.from('retrieved content');
      mockSend.mockResolvedValue({
        Body: Readable.from([testData]),
      });

      const result = await backend.get('archives/test.tar.zst');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('throws when response body is empty', async () => {
      mockSend.mockResolvedValue({ Body: null });

      await expect(backend.get('archives/test.tar.zst')).rejects.toThrow('Empty response body');
    });
  });

  describe('getStream', () => {
    it('returns readable stream', async () => {
      const testStream = Readable.from([Buffer.from('stream content')]);
      mockSend.mockResolvedValue({ Body: testStream });

      const result = await backend.getStream('archives/test.tar.zst');

      expect(result).toBe(testStream);
    });

    it('throws when response body is empty', async () => {
      mockSend.mockResolvedValue({ Body: null });

      await expect(backend.getStream('archives/test.tar.zst')).rejects.toThrow(
        'Empty response body'
      );
    });
  });

  describe('delete', () => {
    it('deletes object', async () => {
      mockSend.mockResolvedValue({});

      await backend.delete('archives/test.tar.zst');

      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });

  describe('exists', () => {
    it('returns true when object exists', async () => {
      mockSend.mockResolvedValue({});

      const result = await backend.exists('archives/test.tar.zst');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('returns false when object does not exist', async () => {
      const notFoundError = new Error('NotFound');
      notFoundError.name = 'NotFound';
      mockSend.mockRejectedValue(notFoundError);

      const result = await backend.exists('archives/nonexistent.tar.zst');

      expect(result).toBe(false);
    });

    it('throws on other errors', async () => {
      const error = new Error('Network error');
      error.name = 'NetworkError';
      mockSend.mockRejectedValue(error);

      await expect(backend.exists('archives/test.tar.zst')).rejects.toThrow('Network error');
    });
  });

  describe('getSize', () => {
    it('returns content length', async () => {
      mockSend.mockResolvedValue({ ContentLength: 12345 });

      const size = await backend.getSize('archives/test.tar.zst');

      expect(size).toBe(12345);
      expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('returns 0 when content length is undefined', async () => {
      mockSend.mockResolvedValue({});

      const size = await backend.getSize('archives/test.tar.zst');

      expect(size).toBe(0);
    });
  });

  describe('putFromPath', () => {
    it('uploads file from path', async () => {
      mockSend.mockResolvedValue({});

      const location = await backend.putFromPath('/tmp/sha256-abc123.tar.zst');

      expect(location).toBe('archives/sha256-abc123.tar.zst');
    });
  });
});
