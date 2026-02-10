import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { IndexStore, S3StorageOptions } from '../interfaces';
import { CacheIndex } from '../../keyResolver/indexManager';
import { INDEX_FILE, INDEX_VERSION } from '../../constants';

/**
 * S3-based index store
 * Stores cache index as a JSON object in S3
 */
export class S3IndexStore implements IndexStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly indexKey: string;
  private etag: string | undefined;

  constructor(options: S3StorageOptions, owner: string, repo: string) {
    this.bucket = options.bucket;
    const prefix = options.prefix || 'gha-cache/';
    this.indexKey = `${prefix}${owner}/${repo}/${INDEX_FILE}`;

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

  async load(): Promise<CacheIndex> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.indexKey,
        })
      );

      // Store ETag for conditional writes
      this.etag = response.ETag;

      if (!response.Body) {
        return createEmptyIndex();
      }

      // Convert stream to string
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks).toString('utf-8');

      const index = JSON.parse(content) as CacheIndex;

      // Handle version migration
      if (index.version === '1') {
        return migrateIndex(index);
      }

      if (index.version !== INDEX_VERSION) {
        return createEmptyIndex();
      }

      return index;
    } catch (err) {
      // Check if it's a not found error
      if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) {
        this.etag = undefined;
        return createEmptyIndex();
      }
      throw err;
    }
  }

  async save(index: CacheIndex): Promise<void> {
    const content = JSON.stringify(index, null, 2);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.indexKey,
          Body: content,
          ContentType: 'application/json',
          // Use conditional write for strong consistency
          ...(this.etag ? { IfMatch: this.etag } : {}),
        })
      );
    } catch (err) {
      // Handle conditional write failure (412 Precondition Failed)
      if (err instanceof Error && err.name === 'PreconditionFailed') {
        throw new Error('Index was modified by another process. Please retry the operation.');
      }
      throw err;
    }
  }

  /**
   * Get the current ETag for the index
   * Used for conditional writes to ensure consistency
   */
  getETag(): string | undefined {
    return this.etag;
  }
}

/**
 * Create an empty cache index
 */
function createEmptyIndex(): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: [],
  };
}

/**
 * Migrate index from v1 to v2
 */
function migrateIndex(index: CacheIndex): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: index.entries.map(entry => ({
      ...entry,
      accessedAt: entry.accessedAt || entry.createdAt,
    })),
  };
}

/**
 * Create an S3IndexStore
 */
export function createS3IndexStore(
  options: S3StorageOptions,
  owner: string,
  repo: string
): IndexStore {
  return new S3IndexStore(options, owner, repo);
}
