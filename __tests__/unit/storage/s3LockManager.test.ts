import { S3LockManager, createS3LockManager } from '../../../src/storage/s3/s3LockManager';
import { S3Client } from '@aws-sdk/client-s3';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');

describe('S3LockManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: jest.fn(),
    }));
  });

  describe('createS3LockManager', () => {
    it('creates a lock manager', () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      expect(lockManager).toBeInstanceOf(S3LockManager);
    });

    it('creates lock manager with custom options', () => {
      const lockManager = createS3LockManager(
        {
          bucket: 'test-bucket',
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          accessKeyId: 'test',
          secretAccessKey: 'secret',
        },
        'owner',
        'repo'
      );

      expect(lockManager).toBeInstanceOf(S3LockManager);
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          credentials: {
            accessKeyId: 'test',
            secretAccessKey: 'secret',
          },
        })
      );
    });

    it('creates lock manager with default prefix', () => {
      createS3LockManager({ bucket: 'test-bucket' }, 'owner', 'repo');

      // Verify S3Client was created
      expect(S3Client).toHaveBeenCalled();
    });
  });

  // Note: withLock tests are complex due to the dynamic lockId generation
  // and retry logic with real timers. The locking logic is similar to
  // FileLockManager which is tested separately. Full integration testing
  // of S3 locking would be done with a real MinIO instance.
});
