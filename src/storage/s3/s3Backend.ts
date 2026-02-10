import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { StorageBackend, S3StorageOptions } from '../interfaces';
import { ARCHIVES_DIR } from '../../constants';

// Threshold for multipart upload (5MB)
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/**
 * S3-compatible storage backend
 * Works with AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2
 */
export class S3StorageBackend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix || 'gha-cache/';

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

    // Only set credentials if explicitly provided
    // Otherwise, SDK will use the credential chain (env vars, IAM role, etc.)
    if (options.accessKeyId && options.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Build the full S3 key for a location
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
    const s3Key = this.buildArchiveKey(hash, extension);

    // Use multipart upload for large files
    if (buffer.length > MULTIPART_THRESHOLD) {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: s3Key,
          Body: buffer,
        },
      });

      await upload.done();
    } else {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: buffer,
        })
      );
    }

    // Return relative location (without prefix)
    return `${ARCHIVES_DIR}/sha256-${hash}${extension}`;
  }

  /**
   * Put an archive file from a local path
   * Reads the file and uploads to S3
   * @param localPath - Full path to the local archive file
   * @returns S3 location (relative path)
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

    const s3Key = this.buildArchiveKey(hash, extension);

    // Use multipart upload for large files
    if (buffer.length > MULTIPART_THRESHOLD) {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: s3Key,
          Body: buffer,
        },
      });

      await upload.done();
    } else {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: buffer,
        })
      );
    }

    // Return relative location
    return `${ARCHIVES_DIR}/${filename}`;
  }

  async get(location: string): Promise<Buffer> {
    const s3Key = this.buildKey(location);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty response body for ${location}`);
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Get a readable stream for the archive
   * Useful for piping directly to extraction
   */
  async getStream(location: string): Promise<Readable> {
    const s3Key = this.buildKey(location);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty response body for ${location}`);
    }

    return response.Body as Readable;
  }

  async delete(location: string): Promise<void> {
    const s3Key = this.buildKey(location);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      })
    );
  }

  async exists(location: string): Promise<boolean> {
    const s3Key = this.buildKey(location);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        })
      );
      return true;
    } catch (err) {
      // Check if it's a not found error
      if (err instanceof Error && err.name === 'NotFound') {
        return false;
      }
      // Re-throw other errors
      throw err;
    }
  }

  async getSize(location: string): Promise<number> {
    const s3Key = this.buildKey(location);

    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      })
    );

    return response.ContentLength || 0;
  }
}

/**
 * Create an S3StorageBackend
 * @param options - S3 configuration options
 */
export function createS3StorageBackend(options: S3StorageOptions): S3StorageBackend {
  return new S3StorageBackend(options);
}
