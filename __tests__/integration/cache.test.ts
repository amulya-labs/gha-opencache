import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageProvider } from '../../src/storage/localProvider';
import { CacheIndex } from '../../src/keyResolver/indexManager';

describe('LocalStorageProvider integration', () => {
  let tempDir: string;
  let cacheDir: string;
  let workDir: string;
  let provider: LocalStorageProvider;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-integration-'));
    cacheDir = path.join(tempDir, 'cache');
    workDir = path.join(tempDir, 'work');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    process.chdir(workDir);

    provider = new LocalStorageProvider(cacheDir, 'test-owner', 'test-repo');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('full cache cycle', () => {
    it('saves and restores cache successfully', async () => {
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

    it('resolves exact match correctly', async () => {
      // Create and save test file
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('exact-key', ['test.txt']);

      // Resolve with exact key
      const result = await provider.resolve('exact-key', []);

      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('exact-key');
      expect(result.entry).toBeDefined();
    });

    it('resolves with restore-keys correctly', async () => {
      // Create and save test file
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('deps-abc123', ['test.txt']);

      // Resolve with different key but matching restore-key
      const result = await provider.resolve('deps-xyz789', ['deps-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBe('deps-abc123');
      expect(result.entry).toBeDefined();
    });

    it('returns no match when nothing matches', async () => {
      const result = await provider.resolve('missing-key', ['other-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBeUndefined();
      expect(result.entry).toBeUndefined();
    });

    it('skips save when entry already exists', async () => {
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

    it('handles multiple paths correctly', async () => {
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

  describe('exists', () => {
    it('returns true for existing key', async () => {
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('exists-key', ['test.txt']);

      const exists = await provider.exists('exists-key');
      expect(exists).toBe(true);
    });

    it('returns false for missing key', async () => {
      const exists = await provider.exists('missing-key');
      expect(exists).toBe(false);
    });
  });

  describe('getIndex', () => {
    it('returns current index state', async () => {
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      await provider.save('key1', ['test.txt']);
      await provider.save('key2', ['test.txt']);

      const index = await provider.getIndex();

      expect(index.entries).toHaveLength(2);
      expect(index.entries.map(e => e.key).sort()).toEqual(['key1', 'key2']);
    });
  });

  describe('TTL expiration', () => {
    it('sets expiresAt when ttlDays is specified', async () => {
      const providerWithTTL = new LocalStorageProvider(cacheDir, 'test-owner', 'ttl-repo', {
        ttlDays: 7,
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      const entry = await providerWithTTL.save('ttl-key', ['test.txt']);

      expect(entry.expiresAt).toBeDefined();
      const expiresAt = new Date(entry.expiresAt!);
      const now = new Date();
      const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysUntilExpiry).toBeGreaterThan(6);
      expect(daysUntilExpiry).toBeLessThan(8);
    });

    it('does not set expiresAt when ttlDays is 0', async () => {
      const providerNoTTL = new LocalStorageProvider(cacheDir, 'test-owner', 'no-ttl-repo', {
        ttlDays: 0,
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      const entry = await providerNoTTL.save('no-ttl-key', ['test.txt']);

      expect(entry.expiresAt).toBeUndefined();
    });

    it('does not resolve expired entries', async () => {
      // Manually create an index with an expired entry
      const repoDir = path.join(cacheDir, 'test-owner', 'expired-repo');
      fs.mkdirSync(path.join(repoDir, 'archives'), { recursive: true });

      // Create a dummy archive file
      fs.writeFileSync(path.join(repoDir, 'archives', 'test.tar.gz'), 'dummy');

      const expiredIndex: CacheIndex = {
        version: '2',
        entries: [
          {
            key: 'expired-key',
            archivePath: 'archives/test.tar.gz',
            createdAt: '2020-01-01T00:00:00Z',
            sizeBytes: 100,
            expiresAt: '2020-01-02T00:00:00Z', // Already expired
            accessedAt: '2020-01-01T00:00:00Z',
          },
        ],
      };
      fs.writeFileSync(path.join(repoDir, 'index.json'), JSON.stringify(expiredIndex));

      const expiredProvider = new LocalStorageProvider(cacheDir, 'test-owner', 'expired-repo');

      const result = await expiredProvider.resolve('expired-key', []);

      expect(result.entry).toBeUndefined();
      expect(result.matchedKey).toBeUndefined();
    });

    it('returns false for exists() on expired entries', async () => {
      const repoDir = path.join(cacheDir, 'test-owner', 'exists-expired-repo');
      fs.mkdirSync(path.join(repoDir, 'archives'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'archives', 'test.tar.gz'), 'dummy');

      const expiredIndex: CacheIndex = {
        version: '2',
        entries: [
          {
            key: 'expired-key',
            archivePath: 'archives/test.tar.gz',
            createdAt: '2020-01-01T00:00:00Z',
            sizeBytes: 100,
            expiresAt: '2020-01-02T00:00:00Z',
            accessedAt: '2020-01-01T00:00:00Z',
          },
        ],
      };
      fs.writeFileSync(path.join(repoDir, 'index.json'), JSON.stringify(expiredIndex));

      const expiredProvider = new LocalStorageProvider(
        cacheDir,
        'test-owner',
        'exists-expired-repo'
      );

      const exists = await expiredProvider.exists('expired-key');
      expect(exists).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entries when max size exceeded', async () => {
      // Create a provider with very small max size (100 bytes)
      // Archives are compressed so even small files have some overhead
      const providerWithLimit = new LocalStorageProvider(cacheDir, 'test-owner', 'lru-repo', {
        maxCacheSizeGb: 100 / (1024 * 1024 * 1024), // 100 bytes limit
      });

      // Create and save first file
      fs.writeFileSync(path.join(workDir, 'test1.txt'), 'a'.repeat(50));
      await providerWithLimit.save('lru-key-1', ['test1.txt']);

      // Verify first entry exists
      let index = await providerWithLimit.getIndex();
      const entry1 = index.entries.find(e => e.key === 'lru-key-1');
      expect(entry1).toBeDefined();

      // The compressed archive is typically ~90-120 bytes
      // Save second file - should trigger eviction of first since total would exceed 100 bytes
      fs.writeFileSync(path.join(workDir, 'test2.txt'), 'b'.repeat(50));
      await providerWithLimit.save('lru-key-2', ['test2.txt']);

      // Check that oldest was evicted (because total would exceed limit)
      index = await providerWithLimit.getIndex();
      // With 100 byte limit and ~90+ byte entries, only one should fit
      expect(index.entries.length).toBe(1);
      expect(index.entries.find(e => e.key === 'lru-key-2')).toBeDefined();
    });
  });

  describe('compression options', () => {
    it('uses gzip when specified', async () => {
      const gzipProvider = new LocalStorageProvider(cacheDir, 'test-owner', 'gzip-repo', {
        compression: { method: 'gzip', level: 6 },
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test content');
      const entry = await gzipProvider.save('gzip-key', ['test.txt']);

      expect(entry.archivePath).toMatch(/\.tar\.gz$/);
    });

    it('supports no compression', async () => {
      const noCompressProvider = new LocalStorageProvider(cacheDir, 'test-owner', 'none-repo', {
        compression: { method: 'none' },
      });

      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test content');
      const entry = await noCompressProvider.save('none-key', ['test.txt']);

      expect(entry.archivePath).toMatch(/\.tar$/);

      // Verify it can be restored
      fs.unlinkSync(path.join(workDir, 'test.txt'));
      await noCompressProvider.restore(entry);
      expect(fs.existsSync(path.join(workDir, 'test.txt'))).toBe(true);
    });
  });

  describe('index migration', () => {
    it('migrates v1 index to v2 on load', async () => {
      const repoDir = path.join(cacheDir, 'test-owner', 'migrate-repo');
      fs.mkdirSync(path.join(repoDir, 'archives'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, 'archives', 'test.tar.gz'), 'dummy');

      // Create a v1 index
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'old-key',
            archivePath: 'archives/test.tar.gz',
            createdAt: '2024-01-15T10:00:00Z',
            sizeBytes: 100,
          },
        ],
      };
      fs.writeFileSync(path.join(repoDir, 'index.json'), JSON.stringify(v1Index));

      const migrateProvider = new LocalStorageProvider(cacheDir, 'test-owner', 'migrate-repo');

      const index = await migrateProvider.getIndex();

      expect(index.version).toBe('2');
      expect(index.entries[0].accessedAt).toBe('2024-01-15T10:00:00Z');
    });
  });

  describe('accessedAt tracking', () => {
    it('sets accessedAt on save', async () => {
      fs.writeFileSync(path.join(workDir, 'test.txt'), 'test');
      const entry = await provider.save('access-key', ['test.txt']);

      expect(entry.accessedAt).toBeDefined();
      expect(new Date(entry.accessedAt!).getTime()).toBeGreaterThan(0);
    });
  });
});
