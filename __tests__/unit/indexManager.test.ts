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
  isExpired,
  filterValidEntries,
  getTotalCacheSize,
  getEntriesByLRU,
  updateAccessTime,
  migrateIndex,
} from '../../src/keyResolver/indexManager';

describe('indexManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createEntry = (
    key: string,
    createdAt: string,
    options: Partial<CacheEntry> = {}
  ): CacheEntry => ({
    key,
    archivePath: `archives/${key}.tar.zst`,
    createdAt,
    sizeBytes: options.sizeBytes ?? 1000,
    expiresAt: options.expiresAt,
    accessedAt: options.accessedAt,
  });

  describe('createEmptyIndex', () => {
    it('creates an empty index with correct version', () => {
      const index = createEmptyIndex();
      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });
  });

  describe('loadIndex', () => {
    it('returns empty index when file does not exist', async () => {
      const index = await loadIndex(tempDir);
      expect(index.version).toBe('2');
      expect(index.entries).toEqual([]);
    });

    it('loads existing index file', async () => {
      const existingIndex: CacheIndex = {
        version: '2',
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

    it('migrates v1 index to v2', async () => {
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-15T10:00:00Z',
            sizeBytes: 1000,
          },
        ],
      };
      fs.writeFileSync(path.join(tempDir, 'index.json'), JSON.stringify(v1Index));

      const index = await loadIndex(tempDir);
      expect(index.version).toBe('2');
      expect(index.entries[0].accessedAt).toBe('2024-01-15T10:00:00Z');
    });
  });

  describe('saveIndex', () => {
    it('creates directory and saves index', async () => {
      const subDir = path.join(tempDir, 'subdir');
      const index: CacheIndex = {
        version: '2',
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
        version: '2',
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
        version: '2',
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
        version: '2',
        entries: [createEntry('target-key', '2024-01-15T10:00:00Z')],
      };

      const entry = findEntry(index, 'target-key');

      expect(entry).toBeDefined();
      expect(entry?.key).toBe('target-key');
    });

    it('returns undefined for non-existent key', () => {
      const index: CacheIndex = {
        version: '2',
        entries: [createEntry('other-key', '2024-01-15T10:00:00Z')],
      };

      const entry = findEntry(index, 'missing-key');

      expect(entry).toBeUndefined();
    });
  });

  describe('findEntriesByPrefix', () => {
    it('finds all entries matching prefix', () => {
      const index: CacheIndex = {
        version: '2',
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
        version: '2',
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

  describe('isExpired', () => {
    it('returns false when expiresAt is undefined', () => {
      const entry = createEntry('test', '2024-01-15T10:00:00Z');

      expect(isExpired(entry)).toBe(false);
    });

    it('returns false when entry has not expired', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const entry = createEntry('test', '2024-01-15T10:00:00Z', {
        expiresAt: '2024-01-20T10:00:00Z',
      });

      expect(isExpired(entry, now)).toBe(false);
    });

    it('returns true when entry has expired', () => {
      const now = new Date('2024-01-25T10:00:00Z');
      const entry = createEntry('test', '2024-01-15T10:00:00Z', {
        expiresAt: '2024-01-20T10:00:00Z',
      });

      expect(isExpired(entry, now)).toBe(true);
    });

    it('returns true when entry expires exactly now', () => {
      const now = new Date('2024-01-20T10:00:00Z');
      const entry = createEntry('test', '2024-01-15T10:00:00Z', {
        expiresAt: '2024-01-20T10:00:00Z',
      });

      expect(isExpired(entry, now)).toBe(true);
    });
  });

  describe('filterValidEntries', () => {
    it('filters out expired entries', () => {
      const now = new Date('2024-01-25T10:00:00Z');
      const entries: CacheEntry[] = [
        createEntry('expired', '2024-01-10T10:00:00Z', { expiresAt: '2024-01-20T10:00:00Z' }),
        createEntry('valid', '2024-01-15T10:00:00Z', { expiresAt: '2024-01-30T10:00:00Z' }),
        createEntry('never-expires', '2024-01-15T10:00:00Z'),
      ];

      const validEntries = filterValidEntries(entries, now);

      expect(validEntries).toHaveLength(2);
      expect(validEntries.map(e => e.key)).toEqual(['valid', 'never-expires']);
    });

    it('returns all entries when none are expired', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const entries: CacheEntry[] = [
        createEntry('entry1', '2024-01-10T10:00:00Z', { expiresAt: '2024-01-30T10:00:00Z' }),
        createEntry('entry2', '2024-01-10T10:00:00Z'),
      ];

      const validEntries = filterValidEntries(entries, now);

      expect(validEntries).toHaveLength(2);
    });
  });

  describe('getTotalCacheSize', () => {
    it('returns sum of all entry sizes', () => {
      const index: CacheIndex = {
        version: '2',
        entries: [
          createEntry('entry1', '2024-01-15T10:00:00Z', { sizeBytes: 1000 }),
          createEntry('entry2', '2024-01-15T10:00:00Z', { sizeBytes: 2000 }),
          createEntry('entry3', '2024-01-15T10:00:00Z', { sizeBytes: 3000 }),
        ],
      };

      expect(getTotalCacheSize(index)).toBe(6000);
    });

    it('returns 0 for empty index', () => {
      const index = createEmptyIndex();

      expect(getTotalCacheSize(index)).toBe(0);
    });
  });

  describe('getEntriesByLRU', () => {
    it('sorts entries by accessedAt ascending (oldest first)', () => {
      const index: CacheIndex = {
        version: '2',
        entries: [
          createEntry('recent', '2024-01-10T10:00:00Z', { accessedAt: '2024-01-20T10:00:00Z' }),
          createEntry('old', '2024-01-10T10:00:00Z', { accessedAt: '2024-01-12T10:00:00Z' }),
          createEntry('mid', '2024-01-10T10:00:00Z', { accessedAt: '2024-01-15T10:00:00Z' }),
        ],
      };

      const sorted = getEntriesByLRU(index);

      expect(sorted[0].key).toBe('old');
      expect(sorted[1].key).toBe('mid');
      expect(sorted[2].key).toBe('recent');
    });

    it('falls back to createdAt when accessedAt is not set', () => {
      const index: CacheIndex = {
        version: '2',
        entries: [
          createEntry('new', '2024-01-20T10:00:00Z'),
          createEntry('old', '2024-01-10T10:00:00Z'),
        ],
      };

      const sorted = getEntriesByLRU(index);

      expect(sorted[0].key).toBe('old');
      expect(sorted[1].key).toBe('new');
    });
  });

  describe('updateAccessTime', () => {
    it('updates accessedAt for matching entry', () => {
      const now = new Date('2024-01-25T10:00:00Z');
      const index: CacheIndex = {
        version: '2',
        entries: [
          createEntry('target', '2024-01-10T10:00:00Z', { accessedAt: '2024-01-10T10:00:00Z' }),
          createEntry('other', '2024-01-10T10:00:00Z', { accessedAt: '2024-01-10T10:00:00Z' }),
        ],
      };

      const updated = updateAccessTime(index, 'target', now);

      expect(updated.entries.find(e => e.key === 'target')?.accessedAt).toBe(
        '2024-01-25T10:00:00.000Z'
      );
      expect(updated.entries.find(e => e.key === 'other')?.accessedAt).toBe('2024-01-10T10:00:00Z');
    });
  });

  describe('migrateIndex', () => {
    it('migrates v1 index to v2', () => {
      const v1Index: CacheIndex = {
        version: '1',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-15T10:00:00Z',
            sizeBytes: 1000,
          },
        ],
      };

      const v2Index = migrateIndex(v1Index);

      expect(v2Index.version).toBe('2');
      expect(v2Index.entries[0].accessedAt).toBe('2024-01-15T10:00:00Z');
      expect(v2Index.entries[0].expiresAt).toBeUndefined();
    });

    it('preserves existing accessedAt during migration', () => {
      const v1Index: CacheIndex = {
        version: '1',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-15T10:00:00Z',
            sizeBytes: 1000,
            accessedAt: '2024-01-20T10:00:00Z',
          },
        ],
      };

      const v2Index = migrateIndex(v1Index);

      expect(v2Index.entries[0].accessedAt).toBe('2024-01-20T10:00:00Z');
    });
  });
});
