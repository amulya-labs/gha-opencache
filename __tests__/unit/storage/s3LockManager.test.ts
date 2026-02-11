import { S3LockManager, createS3LockManager } from '../../../src/storage/s3/s3LockManager';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Mock AWS SDK - don't mock the commands, just the client
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});

describe('S3LockManager', () => {
  let mockSend: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSend = jest.fn();
    (S3Client as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
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

  describe('withLock', () => {
    it('acquires lock atomically when no lock exists', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      // Track the commands sent
      const commands: { name: string; input: unknown }[] = [];
      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;
        commands.push({ name: commandName, input: command.input });

        if (commandName === 'PutObjectCommand') {
          return Promise.resolve({});
        }
        if (commandName === 'GetObjectCommand') {
          // Return current lock for verification
          const content = JSON.stringify({ lockId: 'test-lock', timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        if (commandName === 'DeleteObjectCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await lockManager.withLock(async () => 'success');

      expect(result).toBe('success');

      // Verify the first command was a PutObject with IfNoneMatch: '*' for atomic creation
      const putCommands = commands.filter(c => c.name === 'PutObjectCommand');
      expect(putCommands.length).toBeGreaterThanOrEqual(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((putCommands[0].input as any).IfNoneMatch).toBe('*');
    });

    it('handles precondition failed and retries when lock exists', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      let putAttempts = 0;
      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;

        if (commandName === 'PutObjectCommand') {
          putAttempts++;
          if (putAttempts === 1) {
            // First attempt: PreconditionFailed (lock exists)
            const error = new Error('PreconditionFailed');
            error.name = 'PreconditionFailed';
            return Promise.reject(error);
          }
          // Second attempt succeeds
          return Promise.resolve({});
        }
        if (commandName === 'GetObjectCommand') {
          // Return fresh lock (not stale)
          const content = JSON.stringify({ lockId: 'other-lock', timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        if (commandName === 'DeleteObjectCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const resultPromise = lockManager.withLock(async () => 'success');

      // Advance timers for retry delay
      await jest.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(putAttempts).toBe(2);
    });

    it('handles HTTP 412 status code for precondition failed', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      const commands: { name: string; input: unknown }[] = [];
      let putAttempts = 0;
      let getAttempts = 0;
      let capturedLockId: string | null = null;
      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;
        commands.push({ name: commandName, input: command.input });

        if (commandName === 'PutObjectCommand') {
          putAttempts++;
          if (putAttempts === 1) {
            // First attempt: HTTP 412 (lock exists)
            const error = new Error('Precondition failed');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (error as any).$metadata = { httpStatusCode: 412 };
            return Promise.reject(error);
          }
          // Second attempt (unconditional overwrite of stale lock) succeeds
          // Capture the lockId written
          const body = command.input.Body as string;
          const lockInfo = JSON.parse(body);
          capturedLockId = lockInfo.lockId;
          return Promise.resolve({});
        }
        if (commandName === 'GetObjectCommand') {
          getAttempts++;
          if (getAttempts === 1) {
            // First get: Return stale lock
            const staleTimestamp = Date.now() - 35000; // 35 seconds ago (stale)
            const content = JSON.stringify({ lockId: 'stale-lock', timestamp: staleTimestamp });
            return Promise.resolve({
              Body: Readable.from([Buffer.from(content)]),
            });
          }
          // Subsequent gets: Return the lock we just wrote (for verification and release)
          const content = JSON.stringify({ lockId: capturedLockId, timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        if (commandName === 'DeleteObjectCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await lockManager.withLock(async () => 'success');

      expect(result).toBe('success');

      // Verify the stale lock overwrite was unconditional (no IfNoneMatch)
      const putCommands = commands.filter(c => c.name === 'PutObjectCommand');
      expect(putCommands.length).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((putCommands[1].input as any).IfNoneMatch).toBeUndefined();
    });

    it('throws after max retries when lock is held', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;

        if (commandName === 'PutObjectCommand') {
          const error = new Error('PreconditionFailed');
          error.name = 'PreconditionFailed';
          return Promise.reject(error);
        }
        if (commandName === 'GetObjectCommand') {
          // Return fresh lock (not stale)
          const content = JSON.stringify({ lockId: 'other-lock', timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        return Promise.resolve({});
      });

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
      // The total time would be: 100 + 200 + 400 + 800 + 1600 + 3200 + 5000 + 5000 + 5000 + 5000 = ~26.3s
      // We advance in large chunks to ensure all retries complete
      for (let i = 0; i < 30; i++) {
        await jest.advanceTimersByTimeAsync(5000);
        if (rejected) break;
      }

      await resultPromise;
      expect(rejected).toBe(true);
      expect(errorMessage).toBe('Failed to acquire lock after 10 attempts');
    });

    it('releases lock even if function throws', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      let deleteWasCalled = false;
      let capturedLockId: string | null = null;

      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;

        if (commandName === 'PutObjectCommand') {
          const body = command.input.Body as string;
          const lockInfo = JSON.parse(body);
          capturedLockId = lockInfo.lockId;
          return Promise.resolve({});
        }
        if (commandName === 'GetObjectCommand') {
          const content = JSON.stringify({ lockId: capturedLockId, timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        if (commandName === 'DeleteObjectCommand') {
          deleteWasCalled = true;
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await expect(
        lockManager.withLock(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Verify delete was called
      expect(deleteWasCalled).toBe(true);
    });
  });

  describe('withLock retry behavior on non-precondition errors', () => {
    it('retries lock acquisition after a non-precondition error and eventually succeeds', async () => {
      const lockManager = createS3LockManager(
        { bucket: 'test-bucket', region: 'us-east-1' },
        'owner',
        'repo'
      );

      let attempts = 0;
      mockSend.mockImplementation(command => {
        const commandName = command.constructor.name;

        if (commandName === 'PutObjectCommand') {
          attempts++;
          if (attempts === 1) {
            // Network error (not precondition failed)
            return Promise.reject(new Error('Network error'));
          }
          return Promise.resolve({});
        }
        if (commandName === 'GetObjectCommand') {
          const content = JSON.stringify({ lockId: 'test', timestamp: Date.now() });
          return Promise.resolve({
            Body: Readable.from([Buffer.from(content)]),
          });
        }
        if (commandName === 'DeleteObjectCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const resultPromise = lockManager.withLock(async () => 'success');

      // Advance timer for retry
      await jest.advanceTimersByTimeAsync(200);

      const result = await resultPromise;
      expect(result).toBe('success');
    });
  });
});
