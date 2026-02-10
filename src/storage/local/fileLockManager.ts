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

    const release = await lockfile.lock(this.lockPath, LOCK_OPTIONS);

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
