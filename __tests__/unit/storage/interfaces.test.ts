import { FileIndexStore } from '../../../src/storage/local/fileIndexStore';
import { FileLockManager } from '../../../src/storage/local/fileLockManager';
import { LocalStorageBackend } from '../../../src/storage/local/localBackend';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('storage interfaces', () => {
  describe('FileIndexStore', () => {
    let tempDir: string;
    let indexStore: FileIndexStore;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-store-test-'));
      indexStore = new FileIndexStore(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns empty index when file does not exist', async () => {
      const index = await indexStore.load();
      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('saves and loads index', async () => {
      const testIndex = {
        version: '2',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: new Date().toISOString(),
            sizeBytes: 1000,
            accessedAt: new Date().toISOString(),
          },
        ],
      };

      await indexStore.save(testIndex);
      const loaded = await indexStore.load();

      expect(loaded).toEqual(testIndex);
    });

    it('creates directory when saving', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir');
      const nestedStore = new FileIndexStore(nestedDir);

      await nestedStore.save({ version: '2', entries: [] });

      expect(fs.existsSync(path.join(nestedDir, 'index.json'))).toBe(true);
    });

    it('migrates v1 index to v2', async () => {
      // Write a v1 index directly
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'old-key',
            archivePath: 'archives/old.tar.zst',
            createdAt: '2025-01-01T00:00:00.000Z',
            sizeBytes: 500,
          },
        ],
      };
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'index.json'), JSON.stringify(v1Index));

      const loaded = await indexStore.load();

      expect(loaded.version).toBe('2');
      expect(loaded.entries[0].accessedAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('FileLockManager', () => {
    let tempDir: string;
    let lockManager: FileLockManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
      lockManager = new FileLockManager(path.join(tempDir, 'test.lock'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('executes function while holding lock', async () => {
      const result = await lockManager.withLock(async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('creates lock file directory if it does not exist', async () => {
      const nestedLock = new FileLockManager(path.join(tempDir, 'nested', 'dir', 'test.lock'));

      await nestedLock.withLock(async () => {
        return 'done';
      });

      expect(fs.existsSync(path.join(tempDir, 'nested', 'dir', 'test.lock'))).toBe(true);
    });

    it('releases lock after function completes', async () => {
      await lockManager.withLock(async () => {
        return 'first';
      });

      // Should be able to acquire lock again
      const result = await lockManager.withLock(async () => {
        return 'second';
      });

      expect(result).toBe('second');
    });

    it('releases lock even if function throws', async () => {
      await expect(
        lockManager.withLock(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      // Should be able to acquire lock again
      const result = await lockManager.withLock(async () => {
        return 'recovered';
      });

      expect(result).toBe('recovered');
    });
  });

  describe('LocalStorageBackend', () => {
    let tempDir: string;
    let backend: LocalStorageBackend;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-test-'));
      backend = new LocalStorageBackend(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('stores and retrieves buffer data', async () => {
      const testData = Buffer.from('test content');
      const location = await backend.put('test-key', testData);

      expect(location).toMatch(/^archives\/sha256-[a-f0-9]+\.tar\.zst$/);

      const retrieved = await backend.get(location);
      expect(Buffer.isBuffer(retrieved)).toBe(true);
      expect(retrieved).toEqual(testData);
    });

    it('checks if archive exists', async () => {
      const testData = Buffer.from('test content');
      const location = await backend.put('test-key', testData);

      expect(await backend.exists(location)).toBe(true);
      expect(await backend.exists('archives/nonexistent.tar.zst')).toBe(false);
    });

    it('deletes archive', async () => {
      const testData = Buffer.from('test content');
      const location = await backend.put('test-key', testData);

      expect(await backend.exists(location)).toBe(true);
      await backend.delete(location);
      expect(await backend.exists(location)).toBe(false);
    });

    it('gets archive size', async () => {
      const testData = Buffer.from('test content with some length');
      const location = await backend.put('test-key', testData);

      const size = await backend.getSize(location);
      expect(size).toBe(testData.length);
    });

    it('ensures archives directory exists', async () => {
      const archivesDir = await backend.ensureArchivesDir();
      expect(fs.existsSync(archivesDir)).toBe(true);
      expect(archivesDir).toBe(path.join(tempDir, 'archives'));
    });

    it('throws when getting non-existent archive', async () => {
      await expect(backend.get('archives/nonexistent.tar.zst')).rejects.toThrow(
        'Archive not found'
      );
    });
  });
});
