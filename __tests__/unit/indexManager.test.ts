import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CacheEntry,
  CacheIndex,
  createEmptyIndex,
  loadIndex,
  saveIndex,
  addEntry,
  removeEntry,
  findEntry,
  findEntriesByPrefix,
} from '../../src/keyResolver/indexManager';

describe('indexManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createEntry = (key: string, createdAt: string): CacheEntry => ({
    key,
    archivePath: `archives/${key}.tar.zst`,
    createdAt,
    sizeBytes: 1000,
  });

  describe('createEmptyIndex', () => {
    it('creates an empty index with correct version', () => {
      const index = createEmptyIndex();
      expect(index.version).toBe('1');
      expect(index.entries).toEqual([]);
    });
  });

  describe('loadIndex', () => {
    it('returns empty index when file does not exist', async () => {
      const index = await loadIndex(tempDir);
      expect(index.version).toBe('1');
      expect(index.entries).toEqual([]);
    });

    it('loads existing index file', async () => {
      const existingIndex: CacheIndex = {
        version: '1',
        entries: [createEntry('test-key', '2024-01-15T10:00:00Z')],
      };
      fs.writeFileSync(path.join(tempDir, 'index.json'), JSON.stringify(existingIndex));

      const index = await loadIndex(tempDir);
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].key).toBe('test-key');
    });

    it('returns empty index for invalid JSON', async () => {
      fs.writeFileSync(path.join(tempDir, 'index.json'), 'invalid json');

      const index = await loadIndex(tempDir);
      expect(index.entries).toEqual([]);
    });
  });

  describe('saveIndex', () => {
    it('creates directory and saves index', async () => {
      const subDir = path.join(tempDir, 'subdir');
      const index: CacheIndex = {
        version: '1',
        entries: [createEntry('test-key', '2024-01-15T10:00:00Z')],
      };

      await saveIndex(subDir, index);

      const content = fs.readFileSync(path.join(subDir, 'index.json'), 'utf-8');
      const loaded = JSON.parse(content);
      expect(loaded.entries).toHaveLength(1);
    });
  });

  describe('addEntry', () => {
    it('adds new entry to index', () => {
      const index = createEmptyIndex();
      const entry = createEntry('new-key', '2024-01-15T10:00:00Z');

      const updated = addEntry(index, entry);

      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].key).toBe('new-key');
    });

    it('replaces existing entry with same key', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [createEntry('same-key', '2024-01-10T10:00:00Z')],
      };
      const newEntry = createEntry('same-key', '2024-01-15T10:00:00Z');

      const updated = addEntry(index, newEntry);

      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].createdAt).toBe('2024-01-15T10:00:00Z');
    });
  });

  describe('removeEntry', () => {
    it('removes entry by key', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [
          createEntry('key1', '2024-01-15T10:00:00Z'),
          createEntry('key2', '2024-01-15T10:00:00Z'),
        ],
      };

      const updated = removeEntry(index, 'key1');

      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].key).toBe('key2');
    });
  });

  describe('findEntry', () => {
    it('finds entry by exact key', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [createEntry('target-key', '2024-01-15T10:00:00Z')],
      };

      const entry = findEntry(index, 'target-key');

      expect(entry).toBeDefined();
      expect(entry?.key).toBe('target-key');
    });

    it('returns undefined for non-existent key', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [createEntry('other-key', '2024-01-15T10:00:00Z')],
      };

      const entry = findEntry(index, 'missing-key');

      expect(entry).toBeUndefined();
    });
  });

  describe('findEntriesByPrefix', () => {
    it('finds all entries matching prefix', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [
          createEntry('npm-linux-abc', '2024-01-10T10:00:00Z'),
          createEntry('npm-linux-xyz', '2024-01-15T10:00:00Z'),
          createEntry('yarn-linux-abc', '2024-01-12T10:00:00Z'),
        ],
      };

      const matches = findEntriesByPrefix(index, 'npm-linux-');

      expect(matches).toHaveLength(2);
    });

    it('returns entries sorted by createdAt descending', () => {
      const index: CacheIndex = {
        version: '1',
        entries: [
          createEntry('npm-old', '2024-01-10T10:00:00Z'),
          createEntry('npm-new', '2024-01-15T10:00:00Z'),
          createEntry('npm-mid', '2024-01-12T10:00:00Z'),
        ],
      };

      const matches = findEntriesByPrefix(index, 'npm-');

      expect(matches[0].key).toBe('npm-new');
      expect(matches[1].key).toBe('npm-mid');
      expect(matches[2].key).toBe('npm-old');
    });
  });
});
