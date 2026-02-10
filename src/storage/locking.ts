import * as lockfile from 'proper-lockfile';
import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import { LOCK_OPTIONS } from '../constants';

export interface LockHandle {
  release: () => Promise<void>;
}

export async function acquireLock(lockPath: string): Promise<LockHandle> {
  // Ensure the directory exists
  const dir = path.dirname(lockPath);
  await io.mkdirP(dir);

  // Ensure the file exists (proper-lockfile needs it)
  if (!fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, '');
  }

  const release = await lockfile.lock(lockPath, LOCK_OPTIONS);

  return {
    release: async () => {
      await release();
    },
  };
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}
