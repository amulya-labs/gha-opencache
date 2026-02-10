import { resolveKey } from '../../src/keyResolver/resolver';
import { CacheIndex, CacheEntry } from '../../src/keyResolver/indexManager';

describe('resolveKey', () => {
  const createEntry = (key: string, createdAt: string): CacheEntry => ({
    key,
    archivePath: `archives/sha256-${key}.tar.zst`,
    createdAt,
    sizeBytes: 1000,
  });

  const createIndex = (entries: CacheEntry[]): CacheIndex => ({
    version: '1',
    entries,
  });

  describe('exact match', () => {
    it('returns exact match when primary key matches', () => {
      const entry = createEntry('npm-linux-x64-abc123', '2024-01-15T10:00:00Z');
      const index = createIndex([entry]);

      const result = resolveKey(index, 'npm-linux-x64-abc123', []);

      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('npm-linux-x64-abc123');
      expect(result.entry).toEqual(entry);
    });

    it('returns no match when primary key does not match', () => {
      const entry = createEntry('npm-linux-x64-abc123', '2024-01-15T10:00:00Z');
      const index = createIndex([entry]);

      const result = resolveKey(index, 'npm-linux-x64-xyz789', []);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBeUndefined();
      expect(result.entry).toBeUndefined();
    });
  });

  describe('restore-keys prefix matching', () => {
    it('returns prefix match when restore-key matches', () => {
      const entry = createEntry('npm-linux-x64-abc123', '2024-01-15T10:00:00Z');
      const index = createIndex([entry]);

      const result = resolveKey(index, 'npm-linux-x64-xyz789', ['npm-linux-x64-', 'npm-linux-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBe('npm-linux-x64-abc123');
      expect(result.entry).toEqual(entry);
    });

    it('returns newest entry when multiple entries match prefix', () => {
      const older = createEntry('npm-linux-x64-old', '2024-01-10T10:00:00Z');
      const newer = createEntry('npm-linux-x64-new', '2024-01-15T10:00:00Z');
      const index = createIndex([older, newer]);

      const result = resolveKey(index, 'npm-linux-x64-xyz789', ['npm-linux-x64-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBe('npm-linux-x64-new');
    });

    it('uses first matching restore-key', () => {
      const entry1 = createEntry('npm-linux-abc', '2024-01-15T10:00:00Z');
      const entry2 = createEntry('npm-win-xyz', '2024-01-16T10:00:00Z');
      const index = createIndex([entry1, entry2]);

      const result = resolveKey(index, 'npm-other', ['npm-linux-', 'npm-win-']);

      expect(result.matchedKey).toBe('npm-linux-abc');
    });

    it('tries subsequent restore-keys if earlier ones do not match', () => {
      const entry = createEntry('npm-win-xyz', '2024-01-15T10:00:00Z');
      const index = createIndex([entry]);

      const result = resolveKey(index, 'npm-other', ['npm-linux-', 'npm-win-']);

      expect(result.matchedKey).toBe('npm-win-xyz');
    });
  });

  describe('no match', () => {
    it('returns no match when nothing matches', () => {
      const entry = createEntry('yarn-linux-abc', '2024-01-15T10:00:00Z');
      const index = createIndex([entry]);

      const result = resolveKey(index, 'npm-linux-xyz', ['npm-linux-', 'npm-']);

      expect(result.isExactMatch).toBe(false);
      expect(result.matchedKey).toBeUndefined();
      expect(result.entry).toBeUndefined();
    });

    it('returns no match for empty index', () => {
      const index = createIndex([]);

      const result = resolveKey(index, 'npm-linux-xyz', ['npm-']);

      expect(result.entry).toBeUndefined();
    });
  });
});
