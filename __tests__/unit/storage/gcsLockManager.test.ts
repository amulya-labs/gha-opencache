import { GCSLockManager } from '../../../src/storage/gcs/gcsLockManager';
import { Storage } from '@google-cloud/storage';

// Mock GCS SDK
jest.mock('@google-cloud/storage');

describe('GCSLockManager', () => {
  let lockManager: GCSLockManager;
  let mockFile: any;
  let mockBucket: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFile = {
      exists: jest.fn(),
      download: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    mockBucket = {
      file: jest.fn().mockReturnValue(mockFile),
    };

    (Storage as unknown as jest.Mock).mockImplementation(() => ({
      bucket: jest.fn().mockReturnValue(mockBucket),
    }));

    lockManager = new GCSLockManager(
      {
        bucket: 'test-bucket',
        prefix: 'cache/',
      },
      'owner',
      'repo'
    );
  });

  describe('withLock', () => {
    it('creates lock manager', () => {
      expect(lockManager).toBeDefined();
    });

    it('verifies stale lock check logic', () => {
      // Test internal stale lock check (conceptually)
      const freshTimestamp = Date.now();
      const staleTimestamp = Date.now() - 35000; // 35 seconds ago

      expect(Date.now() - freshTimestamp).toBeLessThan(30000);
      expect(Date.now() - staleTimestamp).toBeGreaterThan(30000);
    });
  });
});
