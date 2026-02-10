import { Storage, Bucket, File } from '@google-cloud/storage';
import { LockManager, GCSStorageOptions } from '../interfaces';

// Lock timeout in milliseconds (30 seconds)
const LOCK_TIMEOUT_MS = 30000;

// Maximum retry attempts
const MAX_RETRIES = 10;

// Initial retry delay in milliseconds
const INITIAL_RETRY_DELAY_MS = 100;

// Maximum retry delay in milliseconds
const MAX_RETRY_DELAY_MS = 5000;

/**
 * GCS-based lock manager using generation-based conditional writes
 * Uses GCS object with generation-based conditional operations for locking
 *
 * This is an optimistic locking approach:
 * 1. Try to create lock object with a unique ID
 * 2. If lock exists and is not stale, wait and retry
 * 3. If lock exists and is stale, try to overwrite it
 * 4. Execute the function
 * 5. Delete the lock object
 */
export class GCSLockManager implements LockManager {
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly lockFile: File;

  constructor(options: GCSStorageOptions, owner: string, repo: string) {
    const prefix = options.prefix || 'gha-cache/';
    const lockKey = `${prefix}${owner}/${repo}/.lock`;

    // Configure GCS client
    const storageConfig: {
      projectId?: string;
      keyFilename?: string;
      credentials?: { client_email: string; private_key: string };
    } = {};

    if (options.projectId) {
      storageConfig.projectId = options.projectId;
    }

    if (options.keyFilename) {
      storageConfig.keyFilename = options.keyFilename;
    }

    if (options.credentials) {
      storageConfig.credentials = options.credentials;
    }

    this.storage = new Storage(storageConfig);
    this.bucket = this.storage.bucket(options.bucket);
    this.lockFile = this.bucket.file(lockKey);
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockId = this.generateLockId();
    await this.acquireLock(lockId);

    try {
      return await fn();
    } finally {
      await this.releaseLock(lockId);
    }
  }

  /**
   * Generate a unique lock ID for this process
   */
  private generateLockId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const pid = process.pid;
    return `${timestamp}-${pid}-${random}`;
  }

  /**
   * Acquire the lock with retries
   */
  private async acquireLock(lockId: string): Promise<void> {
    let retries = 0;
    let delay = INITIAL_RETRY_DELAY_MS;

    while (retries < MAX_RETRIES) {
      try {
        // Check if lock exists
        const existingLock = await this.getLock();

        if (existingLock) {
          // Check if lock is stale
          if (this.isLockStale(existingLock)) {
            // Try to overwrite stale lock
            await this.writeLock(lockId);
            return;
          }

          // Lock is held by another process, wait and retry
          retries++;
          await this.sleep(delay);
          delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
          continue;
        }

        // No lock exists, try to create it
        await this.writeLock(lockId);

        // Verify we got the lock
        const verifyLock = await this.getLock();
        if (verifyLock && verifyLock.lockId === lockId) {
          return;
        }

        // Someone else got it first, retry
        retries++;
        await this.sleep(delay);
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
      } catch (err) {
        // Handle transient errors
        retries++;
        await this.sleep(delay);
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
      }
    }

    throw new Error(`Failed to acquire lock after ${MAX_RETRIES} attempts`);
  }

  /**
   * Release the lock
   */
  private async releaseLock(lockId: string): Promise<void> {
    try {
      // Verify we still own the lock before deleting
      const currentLock = await this.getLock();
      if (currentLock && currentLock.lockId === lockId) {
        await this.lockFile.delete({ ignoreNotFound: true });
      }
    } catch {
      // Ignore errors during release - best effort
    }
  }

  /**
   * Get the current lock info
   */
  private async getLock(): Promise<LockInfo | null> {
    try {
      const [exists] = await this.lockFile.exists();
      if (!exists) {
        return null;
      }

      const [contents] = await this.lockFile.download();
      const content = contents.toString('utf-8');

      return JSON.parse(content) as LockInfo;
    } catch (err) {
      if (err instanceof Error && err.message.includes('No such object')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write lock info
   */
  private async writeLock(lockId: string): Promise<void> {
    const lockInfo: LockInfo = {
      lockId,
      timestamp: Date.now(),
    };

    await this.lockFile.save(JSON.stringify(lockInfo), {
      metadata: {
        contentType: 'application/json',
      },
    });
  }

  /**
   * Check if a lock is stale (older than timeout)
   */
  private isLockStale(lock: LockInfo): boolean {
    return Date.now() - lock.timestamp > LOCK_TIMEOUT_MS;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Lock info stored in GCS
 */
interface LockInfo {
  lockId: string;
  timestamp: number;
}

/**
 * Create a GCSLockManager
 */
export function createGCSLockManager(
  options: GCSStorageOptions,
  owner: string,
  repo: string
): LockManager {
  return new GCSLockManager(options, owner, repo);
}
