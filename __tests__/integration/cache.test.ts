import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageProvider } from '../../src/storage/localProvider';

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
});
