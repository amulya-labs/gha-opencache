import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { LockManager, S3StorageOptions } from '../interfaces';

// Lock timeout in milliseconds (30 seconds)
const LOCK_TIMEOUT_MS = 30000;

// Maximum retry attempts
const MAX_RETRIES = 10;

// Initial retry delay in milliseconds
const INITIAL_RETRY_DELAY_MS = 100;

// Maximum retry delay in milliseconds
const MAX_RETRY_DELAY_MS = 5000;

/**
 * S3-based lock manager using conditional writes
 * Uses S3 object with ETag-based conditional operations for locking
 *
 * This is an optimistic locking approach:
 * 1. Try to create lock object with a unique ID
 * 2. If lock exists and is not stale, wait and retry
 * 3. If lock exists and is stale, try to overwrite it
 * 4. Execute the function
 * 5. Delete the lock object
 */
export class S3LockManager implements LockManager {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly lockKey: string;

  constructor(options: S3StorageOptions, owner: string, repo: string) {
    this.bucket = options.bucket;
    const prefix = options.prefix || 'gha-cache/';
    this.lockKey = `${prefix}${owner}/${repo}/.lock`;

    // Configure S3 client
    const clientConfig: {
      region?: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {};

    if (options.region) {
      clientConfig.region = options.region;
    }

    if (options.endpoint) {
      clientConfig.endpoint = options.endpoint;
    }

    if (options.forcePathStyle) {
      clientConfig.forcePathStyle = options.forcePathStyle;
    }

    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
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
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: this.lockKey,
          })
        );
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
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.lockKey,
        })
      );

      if (!response.Body) {
        return null;
      }

      // Read the body
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks).toString('utf-8');

      return JSON.parse(content) as LockInfo;
    } catch (err) {
      if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) {
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

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.lockKey,
        Body: JSON.stringify(lockInfo),
        ContentType: 'application/json',
      })
    );
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
 * Lock info stored in S3
 */
interface LockInfo {
  lockId: string;
  timestamp: number;
}

/**
 * Create an S3LockManager
 */
export function createS3LockManager(
  options: S3StorageOptions,
  owner: string,
  repo: string
): LockManager {
  return new S3LockManager(options, owner, repo);
}
