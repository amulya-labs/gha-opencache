jest.mock('proper-lockfile');
jest.mock('fs');
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn().mockResolvedValue(undefined),
}));

import * as lockfile from 'proper-lockfile';
import * as io from '@actions/io';
import { existsSync, writeFileSync } from 'fs';
import { acquireLock, withLock } from '../../src/storage/locking';
import { LOCK_OPTIONS } from '../../src/constants';

describe('locking', () => {
  const mockLockfile = lockfile as jest.Mocked<typeof lockfile>;
  const mockIo = io as jest.Mocked<typeof io>;
  const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
  const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('acquireLock', () => {
    const lockPath = '/tmp/cache/.lock';
    let mockRelease: jest.Mock;

    beforeEach(() => {
      mockRelease = jest.fn().mockResolvedValue(undefined);
      mockLockfile.lock.mockResolvedValue(mockRelease);
      mockIo.mkdirP.mockResolvedValue(undefined);
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockReturnValue(undefined);
    });

    it('should create lock directory if it does not exist', async () => {
      await acquireLock(lockPath);

      expect(mockIo.mkdirP).toHaveBeenCalledWith('/tmp/cache');
    });

    it('should create lock file if it does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await acquireLock(lockPath);

      expect(mockExistsSync).toHaveBeenCalledWith(lockPath);
      expect(mockWriteFileSync).toHaveBeenCalledWith(lockPath, '');
    });

    it('should not create lock file if it already exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await acquireLock(lockPath);

      expect(mockExistsSync).toHaveBeenCalledWith(lockPath);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should acquire lock with correct options', async () => {
      await acquireLock(lockPath);

      expect(mockLockfile.lock).toHaveBeenCalledWith(lockPath, LOCK_OPTIONS);
    });

    it('should return lock handle with release function', async () => {
      const handle = await acquireLock(lockPath);

      expect(handle).toBeDefined();
      expect(handle.release).toBeDefined();
      expect(typeof handle.release).toBe('function');
    });

    it('should release lock when handle.release is called', async () => {
      const handle = await acquireLock(lockPath);

      await handle.release();

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should handle nested directory paths', async () => {
      const nestedPath = '/tmp/cache/nested/deep/.lock';

      await acquireLock(nestedPath);

      expect(mockIo.mkdirP).toHaveBeenCalledWith('/tmp/cache/nested/deep');
    });

    it('should handle errors from lockfile.lock', async () => {
      const error = new Error('Lock acquisition failed');
      mockLockfile.lock.mockRejectedValue(error);

      await expect(acquireLock(lockPath)).rejects.toThrow('Lock acquisition failed');
    });
  });

  describe('withLock', () => {
    const lockPath = '/tmp/cache/.lock';
    let mockRelease: jest.Mock;

    beforeEach(() => {
      mockRelease = jest.fn().mockResolvedValue(undefined);
      mockLockfile.lock.mockResolvedValue(mockRelease);
      mockIo.mkdirP.mockResolvedValue(undefined);
      mockExistsSync.mockReturnValue(true);
      mockWriteFileSync.mockReturnValue(undefined);
    });

    it('should execute function with lock acquired', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const result = await withLock(lockPath, fn);

      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
      expect(mockLockfile.lock).toHaveBeenCalledWith(lockPath, LOCK_OPTIONS);
    });

    it('should release lock after function completes', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      await withLock(lockPath, fn);

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should release lock even if function throws error', async () => {
      const error = new Error('Function failed');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(withLock(lockPath, fn)).rejects.toThrow('Function failed');

      expect(mockRelease).toHaveBeenCalled();
    });

    it('should propagate function return value', async () => {
      const fn = jest.fn().mockResolvedValue({ data: 'test', count: 42 });

      const result = await withLock(lockPath, fn);

      expect(result).toEqual({ data: 'test', count: 42 });
    });

    it('should propagate function error', async () => {
      const error = new Error('Custom error');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(withLock(lockPath, fn)).rejects.toThrow('Custom error');
    });

    it('should handle synchronous errors in function', async () => {
      const fn = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await expect(withLock(lockPath, fn)).rejects.toThrow('Sync error');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('should call release exactly once even if function succeeds', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      await withLock(lockPath, fn);

      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('should call release exactly once even if function fails', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      await expect(withLock(lockPath, fn)).rejects.toThrow();

      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('should acquire lock before executing function', async () => {
      const executionOrder: string[] = [];

      mockLockfile.lock.mockImplementation(async () => {
        executionOrder.push('lock');
        return mockRelease;
      });

      const fn = jest.fn().mockImplementation(async () => {
        executionOrder.push('execute');
        return 'result';
      });

      await withLock(lockPath, fn);

      expect(executionOrder).toEqual(['lock', 'execute']);
    });

    it('should handle multiple sequential withLock calls', async () => {
      const fn1 = jest.fn().mockResolvedValue('result1');
      const fn2 = jest.fn().mockResolvedValue('result2');

      const result1 = await withLock(lockPath, fn1);
      const result2 = await withLock(lockPath, fn2);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(mockRelease).toHaveBeenCalledTimes(2);
    });

    describe('error scenarios', () => {
      it('should handle lock acquisition failure', async () => {
        const lockError = new Error('Failed to acquire lock');
        mockLockfile.lock.mockRejectedValue(lockError);
        const fn = jest.fn().mockResolvedValue('result');

        await expect(withLock(lockPath, fn)).rejects.toThrow('Failed to acquire lock');

        expect(fn).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
      });

      it('should handle release failure after successful execution', async () => {
        const releaseError = new Error('Failed to release lock');
        mockRelease.mockRejectedValue(releaseError);
        const fn = jest.fn().mockResolvedValue('result');

        await expect(withLock(lockPath, fn)).rejects.toThrow('Failed to release lock');

        expect(fn).toHaveBeenCalled();
      });

      it('should throw release error when both function and release fail', async () => {
        const fnError = new Error('Function error');
        const releaseError = new Error('Release error');
        mockRelease.mockRejectedValue(releaseError);
        const fn = jest.fn().mockRejectedValue(fnError);

        // When both function and release fail, the release error is thrown from the finally block
        await expect(withLock(lockPath, fn)).rejects.toThrow('Release error');
        expect(fn).toHaveBeenCalled();
      });
    });
  });

  describe('integration scenarios', () => {
    let mockRelease: jest.Mock;

    beforeEach(() => {
      mockRelease = jest.fn().mockResolvedValue(undefined);
      mockLockfile.lock.mockResolvedValue(mockRelease);
      mockIo.mkdirP.mockResolvedValue(undefined);
      mockExistsSync.mockReturnValue(false);
      mockWriteFileSync.mockReturnValue(undefined);
    });

    it('should handle complete lock workflow', async () => {
      const lockPath = '/cache/index/.lock';
      const operations: string[] = [];

      const fn = async () => {
        operations.push('critical-section');
        return 'done';
      };

      const result = await withLock(lockPath, fn);

      expect(mockIo.mkdirP).toHaveBeenCalledWith('/cache/index');
      expect(mockWriteFileSync).toHaveBeenCalledWith(lockPath, '');
      expect(mockLockfile.lock).toHaveBeenCalledWith(lockPath, LOCK_OPTIONS);
      expect(operations).toContain('critical-section');
      expect(mockRelease).toHaveBeenCalled();
      expect(result).toBe('done');
    });
  });
});
