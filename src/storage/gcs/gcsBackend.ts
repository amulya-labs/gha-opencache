import { Storage, Bucket } from '@google-cloud/storage';
import { Readable } from 'stream';
import { StorageBackend, GCSStorageOptions } from '../interfaces';
import { ARCHIVES_DIR } from '../../constants';

// Threshold for resumable upload (5MB)
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

/**
 * Google Cloud Storage backend
 * Uses Google Cloud Storage for artifact storage
 */
export class GCSStorageBackend implements StorageBackend {
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly prefix: string;

  constructor(options: GCSStorageOptions) {
    const prefix = options.prefix || 'gha-cache/';
    this.prefix = prefix;

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

    // Create storage client - will use ADC if no explicit credentials
    this.storage = new Storage(storageConfig);
    this.bucket = this.storage.bucket(options.bucket);
  }

  /**
   * Build the full GCS key for a location
   */
  private buildKey(location: string): string {
    // Location format: archives/sha256-xxx.tar.zst
    // Full key: prefix + location
    return `${this.prefix}${location}`;
  }

  /**
   * Build a new archive key
   */
  private buildArchiveKey(hash: string, extension: string): string {
    return `${this.prefix}${ARCHIVES_DIR}/sha256-${hash}${extension}`;
  }

  async put(key: string, data: Buffer | Readable): Promise<string> {
    // Generate hash from data for naming
    const crypto = await import('crypto');

    let hash: string;
    let buffer: Buffer | undefined;

    if (Buffer.isBuffer(data)) {
      hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
      buffer = data;
    } else {
      // For streams, we need to collect the data to hash it
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
      hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    }

    // Determine extension (default to .tar.zst)
    const extension = '.tar.zst';
    const gcsKey = this.buildArchiveKey(hash, extension);

    const file = this.bucket.file(gcsKey);

    // Use resumable upload for large files
    if (buffer.length > RESUMABLE_THRESHOLD) {
      await file.save(buffer, {
        resumable: true,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    } else {
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    }

    // Return relative location (without prefix)
    return `${ARCHIVES_DIR}/sha256-${hash}${extension}`;
  }

  /**
   * Put an archive file from a local path
   * Reads the file and uploads to GCS
   * @param localPath - Full path to the local archive file
   * @returns GCS location (relative path)
   */
  async putFromPath(localPath: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const buffer = fs.readFileSync(localPath);
    const filename = path.basename(localPath);
    const extension = path.extname(localPath);
    const nameWithoutExt = path.basename(localPath, extension);

    // Extract hash from filename (sha256-xxx)
    const hash = nameWithoutExt.replace('sha256-', '');

    const gcsKey = this.buildArchiveKey(hash, extension);
    const file = this.bucket.file(gcsKey);

    // Use resumable upload for large files
    if (buffer.length > RESUMABLE_THRESHOLD) {
      await file.save(buffer, {
        resumable: true,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    } else {
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: 'application/zstd',
        },
      });
    }

    // Return relative location
    return `${ARCHIVES_DIR}/${filename}`;
  }

  async get(location: string): Promise<Buffer> {
    const gcsKey = this.buildKey(location);
    const file = this.bucket.file(gcsKey);

    const [contents] = await file.download();
    return contents;
  }

  /**
   * Get a readable stream for the archive
   * Useful for piping directly to extraction
   */
  async getStream(location: string): Promise<Readable> {
    const gcsKey = this.buildKey(location);
    const file = this.bucket.file(gcsKey);

    return file.createReadStream();
  }

  async delete(location: string): Promise<void> {
    const gcsKey = this.buildKey(location);
    const file = this.bucket.file(gcsKey);

    await file.delete({ ignoreNotFound: true });
  }

  async exists(location: string): Promise<boolean> {
    const gcsKey = this.buildKey(location);
    const file = this.bucket.file(gcsKey);

    try {
      const [exists] = await file.exists();
      return exists;
    } catch {
      return false;
    }
  }

  async getSize(location: string): Promise<number> {
    const gcsKey = this.buildKey(location);
    const file = this.bucket.file(gcsKey);

    const [metadata] = await file.getMetadata();
    return metadata.size ? parseInt(metadata.size as string, 10) : 0;
  }
}

/**
 * Create a GCSStorageBackend
 * @param options - GCS configuration options
 */
export function createGCSStorageBackend(options: GCSStorageOptions): GCSStorageBackend {
  return new GCSStorageBackend(options);
}
