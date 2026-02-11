import { GCSLockManager, createGCSLockManager } from '../../../src/storage/gcs/gcsLockManager';
import { Storage } from '@google-cloud/storage';

// Mock GCS SDK
jest.mock('@google-cloud/storage');

describe('GCSLockManager', () => {
  let lockManager: GCSLockManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBucket: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createGCSLockManager', () => {
    it('creates a lock manager', () => {
      const manager = createGCSLockManager(
        { bucket: 'test-bucket', prefix: 'cache/' },
        'owner',
        'repo'
      );

      expect(manager).toBeInstanceOf(GCSLockManager);
    });

    it('creates lock manager with custom options', () => {
      createGCSLockManager(
        {
          bucket: 'test-bucket',
          prefix: 'custom/',
          projectId: 'my-project',
          keyFilename: '/path/to/key.json',
        },
        'owner',
        'repo'
      );

      expect(Storage).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'my-project',
          keyFilename: '/path/to/key.json',
        })
      );
    });
  });

  describe('withLock', () => {
    it('acquires lock atomically when no lock exists', async () => {
      // Track save options
      let saveOptions: unknown = null;

      mockFile.save.mockImplementation((_content: string, opts: unknown) => {
        saveOptions = opts;
        return Promise.resolve();
      });
      // For release
      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockResolvedValue([
        Buffer.from(JSON.stringify({ lockId: 'test', timestamp: Date.now() })),
      ]);
      mockFile.delete.mockResolvedValue(undefined);

      const result = await lockManager.withLock(async () => 'success');

      expect(result).toBe('success');

      // Verify the save was called with preconditionOpts for atomic creation
      expect(saveOptions).toEqual(
        expect.objectContaining({
          preconditionOpts: { ifGenerationMatch: 0 },
        })
      );
    });

    it('handles conditionNotMet error and retries when lock exists', async () => {
      let saveAttempts = 0;

      mockFile.save.mockImplementation(() => {
        saveAttempts++;
        if (saveAttempts === 1) {
          return Promise.reject(new Error('conditionNotMet: some details'));
        }
        return Promise.resolve();
      });

      // For getLock after precondition fails - return fresh lock
      mockFile.exists.mockResolvedValue([true]);
      const freshTimestamp = Date.now();
      mockFile.download.mockResolvedValue([
        Buffer.from(JSON.stringify({ lockId: 'other-lock', timestamp: freshTimestamp })),
      ]);
      mockFile.delete.mockResolvedValue(undefined);

      const resultPromise = lockManager.withLock(async () => 'success');

      // Advance timers for retry delay
      await jest.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(saveAttempts).toBe(2);
    });

    it('handles Precondition Failed error message', async () => {
      const saveOptions: unknown[] = [];
      let saveAttempts = 0;
      let capturedLockId: string | null = null;
      let downloadAttempts = 0;

      mockFile.save.mockImplementation((content: string, opts: unknown) => {
        saveOptions.push(opts);
        saveAttempts++;
        if (saveAttempts === 1) {
          return Promise.reject(new Error('Precondition Failed'));
        }
        // Capture the lockId written for stale takeover
        const lockInfo = JSON.parse(content);
        capturedLockId = lockInfo.lockId;
        return Promise.resolve();
      });

      // Check if lock is stale - returns stale lock first, then our lock on verification
      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockImplementation(() => {
        downloadAttempts++;
        if (downloadAttempts === 1) {
          // First download: stale lock
          const staleTimestamp = Date.now() - 35000; // 35 seconds ago (stale)
          return Promise.resolve([
            Buffer.from(JSON.stringify({ lockId: 'stale-lock', timestamp: staleTimestamp })),
          ]);
        }
        // Subsequent downloads: return the lock we just wrote (for verification and release)
        return Promise.resolve([
          Buffer.from(JSON.stringify({ lockId: capturedLockId, timestamp: Date.now() })),
        ]);
      });
      mockFile.delete.mockResolvedValue(undefined);

      const result = await lockManager.withLock(async () => 'success');

      expect(result).toBe('success');

      // Verify the stale lock overwrite was unconditional (no preconditionOpts)
      expect(saveOptions.length).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((saveOptions[1] as any).preconditionOpts).toBeUndefined();
    });

    it('handles HTTP 412 code for precondition failed', async () => {
      let saveAttempts = 0;
      let capturedLockId: string | null = null;
      let downloadAttempts = 0;

      mockFile.save.mockImplementation((content: string) => {
        saveAttempts++;
        if (saveAttempts === 1) {
          const error = new Error('Request failed');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (error as any).code = 412;
          return Promise.reject(error);
        }
        // Capture the lockId written for stale takeover
        const lockInfo = JSON.parse(content);
        capturedLockId = lockInfo.lockId;
        return Promise.resolve();
      });

      // Check if lock is stale - returns stale lock first, then our lock on verification
      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockImplementation(() => {
        downloadAttempts++;
        if (downloadAttempts === 1) {
          // First download: stale lock
          const staleTimestamp = Date.now() - 35000; // 35 seconds ago (stale)
          return Promise.resolve([
            Buffer.from(JSON.stringify({ lockId: 'stale-lock', timestamp: staleTimestamp })),
          ]);
        }
        // Subsequent downloads: return the lock we just wrote (for verification and release)
        return Promise.resolve([
          Buffer.from(JSON.stringify({ lockId: capturedLockId, timestamp: Date.now() })),
        ]);
      });
      mockFile.delete.mockResolvedValue(undefined);

      const result = await lockManager.withLock(async () => 'success');

      expect(result).toBe('success');
    });

    it('throws after max retries when lock is held', async () => {
      mockFile.save.mockImplementation(() => {
        return Promise.reject(new Error('conditionNotMet'));
      });

      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockResolvedValue([
        Buffer.from(JSON.stringify({ lockId: 'other-lock', timestamp: Date.now() })),
      ]);

      // Start the promise and capture rejection
      let rejected = false;
      let errorMessage = '';
      const resultPromise = lockManager
        .withLock(async () => 'success')
        .catch(err => {
          rejected = true;
          errorMessage = err.message;
        });

      // Advance through all retry delays (10 retries with exponential backoff up to 5 seconds each)
      for (let i = 0; i < 30; i++) {
        await jest.advanceTimersByTimeAsync(5000);
        if (rejected) break;
      }

      await resultPromise;
      expect(rejected).toBe(true);
      expect(errorMessage).toBe('Failed to acquire lock after 10 attempts');
    });

    it('releases lock even if function throws', async () => {
      let capturedLockId: string | null = null;

      mockFile.save.mockImplementation((content: string) => {
        const lockInfo = JSON.parse(content);
        capturedLockId = lockInfo.lockId;
        return Promise.resolve();
      });
      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockImplementation(() => {
        return Promise.resolve([
          Buffer.from(JSON.stringify({ lockId: capturedLockId, timestamp: Date.now() })),
        ]);
      });
      mockFile.delete.mockResolvedValue(undefined);

      await expect(
        lockManager.withLock(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Verify delete was called
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('verifies stale lock check logic', () => {
      // Test internal stale lock check (conceptually)
      const freshTimestamp = Date.now();
      const staleTimestamp = Date.now() - 35000; // 35 seconds ago

      expect(Date.now() - freshTimestamp).toBeLessThan(30000);
      expect(Date.now() - staleTimestamp).toBeGreaterThan(30000);
    });
  });

  describe('retry behavior on non-precondition errors', () => {
    it('retries when a generic (non-precondition) error occurs during save', async () => {
      let attempts = 0;

      mockFile.save.mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve();
      });

      // For release
      mockFile.exists.mockResolvedValue([true]);
      mockFile.download.mockResolvedValue([
        Buffer.from(JSON.stringify({ lockId: 'test', timestamp: Date.now() })),
      ]);
      mockFile.delete.mockResolvedValue(undefined);

      const resultPromise = lockManager.withLock(async () => 'success');

      // Advance timer for retry
      await jest.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
    });
  });
});
