import * as lockfile from 'proper-lockfile';
import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import { LockManager } from '../interfaces';
import { LOCK_OPTIONS } from '../../constants';

/**
 * File-based lock manager using proper-lockfile
 * Provides exclusive locking for local filesystem operations
 */
export class FileLockManager implements LockManager {
  private readonly lockPath: string;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    // Ensure the directory exists
    const dir = path.dirname(this.lockPath);
    await io.mkdirP(dir);

    // Ensure the file exists (proper-lockfile needs it)
    if (!fs.existsSync(this.lockPath)) {
      fs.writeFileSync(this.lockPath, '');
    }

    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.lockPath, LOCK_OPTIONS);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        const dir = path.dirname(this.lockPath);
        throw new Error(
          `Permission denied acquiring lock at ${this.lockPath}\n\n` +
          `The cache directory exists but is not writable by the current user.\n` +
          `This can happen if a different user (e.g. root in a container) created it.\n\n` +
          `Fix — run once on your runner host:\n` +
          `  sudo chown -R $(whoami) ${dir}\n\n` +
          `Or point to a directory the runner user already owns:\n` +
          `  export OPENCACHE_PATH=/home/runner/.cache/gha-opencache`
        );
      }
      throw err;
    }

    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

/**
 * Create a FileLockManager for a cache directory
 * @param cacheDir - Cache directory path
 * @param lockFileName - Lock file name (default: 'index.json.lock')
 */
export function createFileLockManager(
  cacheDir: string,
  lockFileName = 'index.json.lock'
): LockManager {
  return new FileLockManager(path.join(cacheDir, lockFileName));
}
