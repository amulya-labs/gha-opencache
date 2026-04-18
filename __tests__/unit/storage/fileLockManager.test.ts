jest.mock('proper-lockfile');
jest.mock('fs');
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn().mockResolvedValue(undefined),
}));

import * as lockfile from 'proper-lockfile';
import { existsSync, writeFileSync } from 'fs';
import { FileLockManager } from '../../../src/storage/local/fileLockManager';

describe('FileLockManager', () => {
  const lockPath = '/srv/gha-cache/praxiom-systems/stock-trading/index.json.lock';
  const mockLockfile = lockfile as jest.Mocked<typeof lockfile>;
  const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
  const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
  let mockRelease: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRelease = jest.fn().mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockReturnValue(undefined);
    mockLockfile.lock.mockResolvedValue(mockRelease);
  });

  describe('withLock', () => {
    it('executes function and returns result', async () => {
      const manager = new FileLockManager(lockPath);
      const result = await manager.withLock(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('releases lock after function completes', async () => {
      const manager = new FileLockManager(lockPath);
      await manager.withLock(() => Promise.resolve());
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('releases lock even if function throws', async () => {
      mockLockfile.lock.mockResolvedValue(mockRelease);
      const manager = new FileLockManager(lockPath);
      await expect(manager.withLock(() => Promise.reject(new Error('fn error')))).rejects.toThrow(
        'fn error'
      );
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws helpful error with fix instructions when lock acquisition is permission denied', async () => {
      const eaccesError = Object.assign(
        new Error(
          "EACCES: permission denied, mkdir '/srv/gha-cache/praxiom-systems/stock-trading/index.json.lock.lock'"
        ),
        { code: 'EACCES' }
      );
      mockLockfile.lock.mockRejectedValue(eaccesError);
      const manager = new FileLockManager(lockPath);

      await expect(manager.withLock(() => Promise.resolve())).rejects.toThrow(
        /Permission denied.*lock.*\/srv\/gha-cache\/praxiom-systems\/stock-trading/s
      );
    });

    it('error message for EACCES includes platform-appropriate fix instructions', async () => {
      const eaccesError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      mockLockfile.lock.mockRejectedValue(eaccesError);
      const manager = new FileLockManager(lockPath);

      const fixPattern = process.platform === 'win32' ? /icacls.*\/grant/ : /chown/;
      await expect(manager.withLock(() => Promise.resolve())).rejects.toThrow(fixPattern);
    });

    it('propagates non-permission errors unchanged', async () => {
      const otherError = new Error('Lock already held');
      mockLockfile.lock.mockRejectedValue(otherError);
      const manager = new FileLockManager(lockPath);

      await expect(manager.withLock(() => Promise.resolve())).rejects.toThrow('Lock already held');
    });
  });
});
