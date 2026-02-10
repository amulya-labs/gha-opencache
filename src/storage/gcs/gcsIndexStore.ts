import { Storage, Bucket, File } from '@google-cloud/storage';
import { IndexStore, GCSStorageOptions } from '../interfaces';
import { CacheIndex } from '../../keyResolver/indexManager';
import { INDEX_FILE, INDEX_VERSION } from '../../constants';

/**
 * GCS-based index store
 * Stores cache index as a JSON object in GCS
 * Uses generation-based optimistic locking for consistency
 */
export class GCSIndexStore implements IndexStore {
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly indexFile: File;
  private generation: number | undefined;

  constructor(options: GCSStorageOptions, owner: string, repo: string) {
    const prefix = options.prefix || 'gha-cache/';
    const indexKey = `${prefix}${owner}/${repo}/${INDEX_FILE}`;

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
    this.indexFile = this.bucket.file(indexKey);
  }

  async load(): Promise<CacheIndex> {
    try {
      const [exists] = await this.indexFile.exists();
      if (!exists) {
        this.generation = undefined;
        return createEmptyIndex();
      }

      // Get metadata to track generation
      const [metadata] = await this.indexFile.getMetadata();
      this.generation = metadata.generation ? parseInt(metadata.generation as string, 10) : undefined;

      // Download content
      const [contents] = await this.indexFile.download();
      const content = contents.toString('utf-8');

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
      // Return empty index if file doesn't exist
      if (err instanceof Error && err.message.includes('No such object')) {
        this.generation = undefined;
        return createEmptyIndex();
      }
      throw err;
    }
  }

  async save(index: CacheIndex): Promise<void> {
    const content = JSON.stringify(index, null, 2);

    try {
      // Use generation-based conditional write for optimistic locking
      const saveOptions: {
        metadata?: { contentType: string };
        preconditionOpts?: { ifGenerationMatch?: number };
      } = {
        metadata: {
          contentType: 'application/json',
        },
      };

      // If we have a generation, use it for conditional write
      if (this.generation !== undefined) {
        saveOptions.preconditionOpts = {
          ifGenerationMatch: this.generation,
        };
      }

      await this.indexFile.save(content, saveOptions);

      // Update generation after successful save
      const [metadata] = await this.indexFile.getMetadata();
      this.generation = metadata.generation ? parseInt(metadata.generation as string, 10) : undefined;
    } catch (err) {
      // Handle conditional write failure (precondition failed)
      if (err instanceof Error && err.message.includes('conditionNotMet')) {
        throw new Error('Index was modified by another process. Please retry the operation.');
      }
      throw err;
    }
  }

  /**
   * Get the current generation for the index
   * Used for conditional writes to ensure consistency
   */
  getGeneration(): number | undefined {
    return this.generation;
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
 * Create a GCSIndexStore
 */
export function createGCSIndexStore(
  options: GCSStorageOptions,
  owner: string,
  repo: string
): IndexStore {
  return new GCSIndexStore(options, owner, repo);
}
