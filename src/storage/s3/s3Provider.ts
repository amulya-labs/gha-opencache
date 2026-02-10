import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as core from '@actions/core';
import * as io from '@actions/io';
import { StorageProvider, S3StorageOptions } from '../interfaces';
import { BaseStorageProvider, BaseStorageOptions, formatBytes } from '../baseProvider';
import { S3StorageBackend, createS3StorageBackend } from './s3Backend';
import { createS3IndexStore } from './s3IndexStore';
import { createS3LockManager } from './s3LockManager';
import { CacheEntry, findEntry, addEntry } from '../../keyResolver/indexManager';
import { createArchive, extractArchive } from '../../archive/tar';
import { CompressionOptions } from '../../archive/compression';

/**
 * Options for S3 storage provider
 */
export interface S3ProviderOptions extends BaseStorageOptions {
  compression?: CompressionOptions;
}

/**
 * S3-compatible storage provider
 * Uses S3 or S3-compatible services (MinIO, R2, Spaces) for storage
 */
export class S3StorageProvider extends BaseStorageProvider implements StorageProvider {
  private readonly s3Options: S3StorageOptions;
  private readonly owner: string;
  private readonly repo: string;
  private readonly s3Backend: S3StorageBackend;

  constructor(
    s3Options: S3StorageOptions,
    owner: string,
    repo: string,
    options: S3ProviderOptions = {}
  ) {
    const s3Backend = createS3StorageBackend({
      ...s3Options,
      // Adjust prefix to include owner/repo
      prefix: `${s3Options.prefix || 'gha-cache/'}${owner}/${repo}/`,
    });
    const indexStore = createS3IndexStore(s3Options, owner, repo);
    const lockManager = createS3LockManager(s3Options, owner, repo);

    super(s3Backend, indexStore, lockManager, options);

    this.s3Options = s3Options;
    this.owner = owner;
    this.repo = repo;
    this.s3Backend = s3Backend;
  }

  async restore(entry: CacheEntry): Promise<void> {
    // Check if archive exists
    if (!(await this.backend.exists(entry.archivePath))) {
      throw new Error(`Cache archive not found: ${entry.archivePath}`);
    }

    // Download archive to temp file
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gha-cache-'));
    const tempArchive = path.join(tempDir, path.basename(entry.archivePath));

    try {
      core.info(`Downloading cache archive from S3...`);
      const data = await this.backend.get(entry.archivePath);
      // S3 backend always returns Buffer
      if (Buffer.isBuffer(data)) {
        fs.writeFileSync(tempArchive, data);
      } else {
        // Handle Readable stream (shouldn't happen with S3 backend's get())
        const chunks: Buffer[] = [];
        for await (const chunk of data) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        fs.writeFileSync(tempArchive, Buffer.concat(chunks));
      }

      core.info(`Extracting cache...`);
      await extractArchive(tempArchive, process.cwd());
      core.info(`Cache restored successfully`);

      // Update accessedAt for LRU tracking (best-effort)
      await this.updateAccessTimeForEntry(entry.key);
    } finally {
      // Clean up temp directory
      try {
        await io.rmRF(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async save(key: string, paths: string[]): Promise<CacheEntry> {
    return this.lockManager.withLock(async () => {
      let index = await this.indexStore.load();

      // Check if entry already exists
      const existing = findEntry(index, key);
      if (existing) {
        core.info(`Cache entry already exists for key: ${key}`);
        return existing;
      }

      // Clean up expired entries opportunistically
      const { index: cleanedIndex, deletedCount } = await this.cleanupExpiredEntries(index);
      if (deletedCount > 0) {
        core.info(`Cleaned up ${deletedCount} expired cache entries`);
      }
      index = cleanedIndex;

      // Create archive in temp directory
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gha-cache-'));

      try {
        core.info(`Creating cache archive for ${paths.length} path(s)`);

        const compressionOptions = this.options.compression as CompressionOptions | undefined;
        const result = await createArchive(paths, tempDir, undefined, compressionOptions);

        // Upload to S3
        core.info(`Uploading cache archive to S3...`);
        const location = await this.s3Backend.putFromPath(result.archivePath);

        // Calculate expiration time
        const expiresAt = this.calculateExpiresAt();
        const now = new Date().toISOString();

        const entry: CacheEntry = {
          key,
          archivePath: location,
          createdAt: now,
          sizeBytes: result.sizeBytes,
          expiresAt,
          accessedAt: now,
        };

        // Check if we need to evict entries before adding
        index = await this.maybeEvict(index, entry.sizeBytes);

        // Update index
        const updatedIndex = addEntry(index, entry);
        await this.indexStore.save(updatedIndex);

        core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

        return entry;
      } finally {
        // Clean up temp directory
        try {
          await io.rmRF(tempDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  }
}

/**
 * Create an S3 storage provider
 */
export function createS3StorageProvider(
  s3Options: S3StorageOptions,
  owner: string,
  repo: string,
  options?: S3ProviderOptions
): StorageProvider {
  return new S3StorageProvider(s3Options, owner, repo, options);
}
