import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2Output,
} from '@aws-sdk/client-s3';
import { createS3StorageProvider } from '../../src/storage/s3/s3Provider';
import { S3StorageOptions } from '../../src/storage/interfaces';

/**
 * S3 Integration Tests using MinIO
 *
 * These tests require MinIO to be running. They will skip gracefully if MinIO is unavailable.
 * To run locally:
 *   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio:latest server /data
 *   npm run test:s3
 */

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const TEST_BUCKET = 'opencache-test';

// Helper to check if MinIO is available
async function checkMinioAvailability(): Promise<boolean> {
  const client = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFound') {
      // Bucket doesn't exist, try to create it
      try {
        await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// Check availability before defining tests
let minioAvailable = false;

beforeAll(async () => {
  minioAvailable = await checkMinioAvailability();
  if (!minioAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n⚠️  MinIO not available - S3 integration tests will be skipped.\n' +
        '   To run these tests locally, start MinIO:\n' +
        '   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio:latest server /data\n'
    );
  }
});

describe('S3 Storage Provider Integration', () => {
  let tempDir: string;
  let workDir: string;
  let s3Client: S3Client;
  let s3Options: S3StorageOptions;
  const originalCwd = process.cwd();

  beforeAll(() => {
    s3Client = new S3Client({
      endpoint: MINIO_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: MINIO_ACCESS_KEY,
        secretAccessKey: MINIO_SECRET_KEY,
      },
    });

    s3Options = {
      bucket: TEST_BUCKET,
      endpoint: MINIO_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    };
  });

  async function listAllObjects(token?: string): Promise<ListObjectsV2Output> {
    return s3Client.send(
      new ListObjectsV2Command({
        Bucket: TEST_BUCKET,
        ContinuationToken: token,
      })
    );
  }

  async function cleanupBucket(): Promise<void> {
    try {
      let continuationToken: string | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const listResult = await listAllObjects(continuationToken);
        const contents = listResult.Contents || [];

        if (contents.length > 0) {
          // AWS S3 limits DeleteObjects to 1000 objects per request
          const batchSize = 1000;
          for (let i = 0; i < contents.length; i += batchSize) {
            const batch = contents.slice(i, i + batchSize);
            const objectsToDelete = batch
              .filter(obj => obj.Key != null)
              .map(obj => ({ Key: obj.Key! }));

            if (objectsToDelete.length > 0) {
              await s3Client.send(
                new DeleteObjectsCommand({
                  Bucket: TEST_BUCKET,
                  Delete: { Objects: objectsToDelete },
                })
              );
            }
          }
        }

        hasMore = listResult.IsTruncated === true;
        continuationToken = listResult.NextContinuationToken;
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  beforeEach(async function () {
    if (!minioAvailable) {
      return;
    }

    // Clean up bucket before each test
    await cleanupBucket();

    // Create temp directories
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-integration-'));
    workDir = path.join(tempDir, 'work');
    fs.mkdirSync(workDir, { recursive: true });
    process.chdir(workDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    if (minioAvailable) {
      await cleanupBucket();
    }
  });

  // Helper to skip test if MinIO not available
  const itIfMinio = (name: string, fn: () => Promise<void>, timeout?: number): void => {
    it(
      name,
      async () => {
        if (!minioAvailable) {
          // Return early - beforeAll already warned user
          return;
        }
        await fn();
      },
      timeout
    );
  };

  describe('Basic Operations', () => {
    itIfMinio('saves and restores cache successfully', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      // Create test files
      const testDir = path.join(workDir, 'node_modules');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(testDir, 'data.txt'), 'test data content');

      // Save cache
      const entry = await provider.save('npm-linux-abc123', ['node_modules']);

      expect(entry.key).toBe('npm-linux-abc123');
      expect(entry.sizeBytes).toBeGreaterThan(0);

      // Delete original files
      fs.rmSync(testDir, { recursive: true });
      expect(fs.existsSync(testDir)).toBe(false);

      // Restore cache
      await provider.restore(entry);

      // Verify files restored
      expect(fs.existsSync(path.join(testDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'data.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'data.txt'), 'utf-8')).toBe('test data content');
    });

    itIfMinio('resolves exact match correctly', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      // Create and save test file
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('exact-key', ['test.txt']);

      // Resolve with exact key
      const result = await provider.resolve('exact-key', []);

      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('exact-key');
      expect(result.entry).toBeDefined();
    });

    itIfMinio('resolves with restore-keys (prefix match)', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      // Create and save test file
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('deps-abc123', ['test.txt']);

      // Resolve with different key but matching restore-key
      const result = await provider.resolve('deps-xyz789', ['deps-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBe('deps-abc123');
      expect(result.entry).toBeDefined();
    });

    itIfMinio('returns no match when nothing matches', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      const result = await provider.resolve('missing-key', ['other-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBeUndefined();
      expect(result.entry).toBeUndefined();
    });

    itIfMinio('skips save when entry already exists (idempotency)', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      // Create and save test file
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'original');
      const entry1 = await provider.save('duplicate-key', ['test.txt']);

      // Modify file and try to save again
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'modified');
      const entry2 = await provider.save('duplicate-key', ['test.txt']);

      // Should return same entry without updating
      expect(entry2.archivePath).toBe(entry1.archivePath);
      expect(entry2.createdAt).toBe(entry1.createdAt);
    });

    itIfMinio('handles multiple paths correctly', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'test-repo');

      // Create test files in different directories
      fs.mkdirSync(path.join(workDir, 'dir1'), { recursive: true });
      fs.mkdirSync(path.join(workDir, 'dir2'), { recursive: true });
      fs.writeFileSync(path.join(workDir, 'dir1', 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(workDir, 'dir2', 'file2.txt'), 'content2');

      // Save cache with multiple paths
      const entry = await provider.save('multi-path', ['dir1', 'dir2']);

      // Delete original files
      fs.rmSync(path.join(workDir, 'dir1'), { recursive: true });
      fs.rmSync(path.join(workDir, 'dir2'), { recursive: true });

      // Restore cache
      await provider.restore(entry);

      // Verify all files restored
      expect(fs.readFileSync(path.join(workDir, 'dir1', 'file1.txt'), 'utf-8')).toBe('content1');
      expect(fs.readFileSync(path.join(workDir, 'dir2', 'file2.txt'), 'utf-8')).toBe('content2');
    });
  });

  describe('Concurrent Operations', () => {
    itIfMinio('handles parallel saves with different keys', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'concurrent-repo');

      // Create test files
      fs.writeFileSync(path.join(workDir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(workDir, 'file2.txt'), 'content2');
      fs.writeFileSync(path.join(workDir, 'file3.txt'), 'content3');

      // Save in parallel
      const [entry1, entry2, entry3] = await Promise.all([
        provider.save('parallel-key-1', ['file1.txt']),
        provider.save('parallel-key-2', ['file2.txt']),
        provider.save('parallel-key-3', ['file3.txt']),
      ]);

      expect(entry1.key).toBe('parallel-key-1');
      expect(entry2.key).toBe('parallel-key-2');
      expect(entry3.key).toBe('parallel-key-3');

      // Verify all entries exist
      const index = await provider.getIndex();
      expect(index.entries.length).toBe(3);
    });

    itIfMinio('handles lock contention gracefully', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'lock-repo');

      // Create test file
      fs.writeFileSync(path.join(workDir, 'shared.txt'), 'shared content');

      // Attempt same key save from multiple "processes"
      const results = await Promise.all([
        provider.save('contention-key', ['shared.txt']),
        provider.save('contention-key', ['shared.txt']),
        provider.save('contention-key', ['shared.txt']),
      ]);

      // All should succeed and return the same entry
      expect(results[0].archivePath).toBe(results[1].archivePath);
      expect(results[1].archivePath).toBe(results[2].archivePath);
    });
  });

  describe('Large Files (Multipart Upload)', () => {
    itIfMinio(
      'handles files larger than 5MB',
      async () => {
        const provider = createS3StorageProvider(s3Options, 'test-owner', 'large-file-repo');

        // Create a file larger than 5MB (multipart threshold)
        const largeContent = 'x'.repeat(6 * 1024 * 1024); // 6MB
        const largeDir = path.join(workDir, 'large');
        fs.mkdirSync(largeDir, { recursive: true });
        fs.writeFileSync(path.join(largeDir, 'large.txt'), largeContent);

        // Save - the file is large but compresses well with zstd
        // What matters is the save/restore cycle works for large original files
        const entry = await provider.save('large-file-key', ['large']);

        expect(entry.key).toBe('large-file-key');
        expect(entry.sizeBytes).toBeGreaterThan(0);

        // Delete and restore
        fs.rmSync(largeDir, { recursive: true });
        await provider.restore(entry);

        // Verify content matches
        const restored = fs.readFileSync(path.join(largeDir, 'large.txt'), 'utf-8');
        expect(restored.length).toBe(largeContent.length);
      },
      60000
    ); // 60s timeout for large file test
  });

  describe('Compression Options', () => {
    itIfMinio('saves with zstd compression (default)', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'zstd-repo');

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test content');
      const entry = await provider.save('zstd-key', ['test.txt']);

      expect(entry.archivePath).toMatch(/\.tar\.zst$/);
    });

    itIfMinio('saves with gzip compression', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'gzip-repo', {
        compression: { method: 'gzip', level: 6 },
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test content');
      const entry = await provider.save('gzip-key', ['test.txt']);

      expect(entry.archivePath).toMatch(/\.tar\.gz$/);

      // Verify restore works with gzip
      fs.unlinkSync(path.join(workDir, 'test.txt'));
      await provider.restore(entry);
      expect(fs.existsSync(path.join(workDir, 'test.txt'))).toBe(true);
    });

    itIfMinio('saves without compression', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'none-repo', {
        compression: { method: 'none' },
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test content');
      const entry = await provider.save('none-key', ['test.txt']);

      expect(entry.archivePath).toMatch(/\.tar$/);

      // Verify restore works without compression
      fs.unlinkSync(path.join(workDir, 'test.txt'));
      await provider.restore(entry);
      expect(fs.existsSync(path.join(workDir, 'test.txt'))).toBe(true);
    });
  });

  describe('TTL and LRU', () => {
    itIfMinio('sets expiresAt when ttlDays is specified', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'ttl-repo', { ttlDays: 7 });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      const entry = await provider.save('ttl-key', ['test.txt']);

      expect(entry.expiresAt).toBeDefined();
      const expiresAt = new Date(entry.expiresAt!);
      const now = new Date();
      const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysUntilExpiry).toBeGreaterThan(6);
      expect(daysUntilExpiry).toBeLessThan(8);
    });

    itIfMinio('evicts oldest entries when max size exceeded', async () => {
      // Use explicit file sizes so eviction logic doesn't depend on tar's internal block size.
      // 8KB per file provides predictable archive sizes for testing eviction.
      const FILE_SIZE_BYTES = 8 * 1024; // 8KB per file
      const maxCacheSizeBytes = (FILE_SIZE_BYTES * 3) / 2; // >1 file, <2 files

      const provider = createS3StorageProvider(s3Options, 'test-owner', 'lru-repo', {
        maxCacheSizeGb: maxCacheSizeBytes / (1024 * 1024 * 1024),
        compression: { method: 'none' },
      });

      // Create and save first file
      fs.writeFileSync(path.join(workDir, 'test1.txt'), 'a'.repeat(FILE_SIZE_BYTES));
      await provider.save('lru-key-1', ['test1.txt']);

      // Verify first entry exists
      let index = await provider.getIndex();
      expect(index.entries.find(e => e.key === 'lru-key-1')).toBeDefined();

      // Save second file - should trigger eviction since total exceeds maxCacheSizeBytes
      fs.writeFileSync(path.join(workDir, 'test2.txt'), 'b'.repeat(FILE_SIZE_BYTES));
      await provider.save('lru-key-2', ['test2.txt']);

      // Check that oldest was evicted
      index = await provider.getIndex();
      expect(index.entries.length).toBe(1);
      expect(index.entries.find(e => e.key === 'lru-key-2')).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    itIfMinio('throws error when restoring missing archive', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'error-repo');

      await expect(
        provider.restore({
          key: 'missing-key',
          archivePath: 'archives/missing.tar.zst',
          createdAt: new Date().toISOString(),
          sizeBytes: 1000,
        })
      ).rejects.toThrow('Cache archive not found');
    });

    itIfMinio('handles missing bucket gracefully', async () => {
      const badOptions: S3StorageOptions = {
        ...s3Options,
        bucket: 'nonexistent-bucket-12345',
      };

      const provider = createS3StorageProvider(badOptions, 'test-owner', 'test-repo');

      // Should throw with specific S3 error when trying to save to nonexistent bucket
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await expect(provider.save('test-key', ['test.txt'])).rejects.toThrow(
        /NoSuchBucket|bucket.*not.*exist|not.*found/i
      );
    });
  });

  describe('Exists Check', () => {
    itIfMinio('returns true for existing key', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'exists-repo');

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('exists-key', ['test.txt']);

      const exists = await provider.exists('exists-key');
      expect(exists).toBe(true);
    });

    itIfMinio('returns false for missing key', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'exists-repo');

      const exists = await provider.exists('missing-key');
      expect(exists).toBe(false);
    });
  });

  describe('Index Operations', () => {
    itIfMinio('returns current index state', async () => {
      const provider = createS3StorageProvider(s3Options, 'test-owner', 'index-repo');

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('key1', ['test.txt']);
      await provider.save('key2', ['test.txt']);

      const index = await provider.getIndex();

      expect(index.entries).toHaveLength(2);
      expect(index.entries.map(e => e.key).sort()).toEqual(['key1', 'key2']);
    });
  });
});
