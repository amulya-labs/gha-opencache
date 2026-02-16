/**
 * Property-based fuzz tests for key resolution and index management
 *
 * Uses fast-check to generate random inputs and verify invariants hold
 * for all possible input combinations. This helps catch edge cases that
 * traditional unit tests might miss.
 */
import * as fc from 'fast-check';
import {
  CacheEntry,
  findEntry,
  findEntriesByPrefix,
  addEntry,
  removeEntry,
  isExpired,
  filterValidEntries,
  getEntriesByLRU,
  getTotalCacheSize,
  migrateIndex,
  createEmptyIndex,
} from '../../src/keyResolver/indexManager';
import { resolveKey } from '../../src/keyResolver/resolver';
import { getCompressionMethodFromPath, getArchiveExtension } from '../../src/archive/compression';

// Arbitrary generators for test data

// Use integer timestamps to avoid invalid date issues
const minDate = new Date('2020-01-01').getTime();
const maxDate = new Date('2030-12-31').getTime();

const isoDateArb = fc.integer({ min: minDate, max: maxDate }).map(ts => new Date(ts).toISOString());

const cacheEntryArb = fc.record({
  key: fc.string({ minLength: 1 }),
  archivePath: fc.string({ minLength: 1 }),
  createdAt: isoDateArb,
  sizeBytes: fc.nat({ max: 1_000_000_000 }),
  expiresAt: fc.option(isoDateArb, { nil: undefined }),
  accessedAt: fc.option(isoDateArb, { nil: undefined }),
});

const cacheIndexArb = fc.record({
  version: fc.constant('2'),
  entries: fc.array(cacheEntryArb, { maxLength: 100 }),
});

describe('Key Resolver Fuzz Tests', () => {
  describe('findEntry', () => {
    it('should return undefined for keys not in index', () => {
      fc.assert(
        fc.property(cacheIndexArb, fc.string(), (index, searchKey) => {
          const hasKey = index.entries.some(e => e.key === searchKey);
          const result = findEntry(index, searchKey);
          if (!hasKey) {
            expect(result).toBeUndefined();
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should find entry when key exists', () => {
      fc.assert(
        fc.property(cacheIndexArb, fc.nat(), (index, randomIndex) => {
          if (index.entries.length === 0) return true;
          const randomEntry = index.entries[randomIndex % index.entries.length];
          const result = findEntry(index, randomEntry.key);
          expect(result?.key).toBe(randomEntry.key);
          return true;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('findEntriesByPrefix', () => {
    it('all returned entries should have keys starting with prefix', () => {
      fc.assert(
        fc.property(cacheIndexArb, fc.string(), (index, prefix) => {
          const results = findEntriesByPrefix(index, prefix);
          results.forEach(entry => {
            expect(entry.key.startsWith(prefix)).toBe(true);
          });
        }),
        { numRuns: 500 }
      );
    });

    it('should return results sorted by createdAt descending', () => {
      fc.assert(
        fc.property(cacheIndexArb, fc.string(), (index, prefix) => {
          const results = findEntriesByPrefix(index, prefix);
          for (let i = 1; i < results.length; i++) {
            const prevTime = new Date(results[i - 1].createdAt).getTime();
            const currTime = new Date(results[i].createdAt).getTime();
            expect(prevTime).toBeGreaterThanOrEqual(currTime);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('empty prefix should match all entries', () => {
      fc.assert(
        fc.property(cacheIndexArb, index => {
          const results = findEntriesByPrefix(index, '');
          expect(results.length).toBe(index.entries.length);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('addEntry and removeEntry', () => {
    it('addEntry followed by findEntry should return the added entry', () => {
      fc.assert(
        fc.property(cacheIndexArb, cacheEntryArb, (index, entry) => {
          const newIndex = addEntry(index, entry);
          const found = findEntry(newIndex, entry.key);
          expect(found?.key).toBe(entry.key);
          expect(found?.archivePath).toBe(entry.archivePath);
        }),
        { numRuns: 500 }
      );
    });

    it('removeEntry should remove the entry', () => {
      fc.assert(
        fc.property(cacheIndexArb, cacheEntryArb, (index, entry) => {
          const withEntry = addEntry(index, entry);
          const withoutEntry = removeEntry(withEntry, entry.key);
          const found = findEntry(withoutEntry, entry.key);
          expect(found).toBeUndefined();
        }),
        { numRuns: 500 }
      );
    });

    it('addEntry should replace existing entry with same key', () => {
      fc.assert(
        fc.property(cacheIndexArb, cacheEntryArb, fc.string(), (index, entry, newPath) => {
          const first = addEntry(index, entry);
          const modified = { ...entry, archivePath: newPath };
          const second = addEntry(first, modified);
          const found = findEntry(second, entry.key);
          expect(found?.archivePath).toBe(newPath);
          // Count should not increase
          const countBefore = first.entries.filter(e => e.key === entry.key).length;
          const countAfter = second.entries.filter(e => e.key === entry.key).length;
          expect(countAfter).toBe(countBefore);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('isExpired', () => {
    it('entry without expiresAt should never be expired', () => {
      fc.assert(
        fc.property(
          cacheEntryArb.map(e => ({ ...e, expiresAt: undefined })),
          fc.date(),
          (entry, now) => {
            expect(isExpired(entry, now)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('entry with future expiresAt should not be expired', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: minDate, max: maxDate }),
          fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }),
          (nowTs, offset) => {
            const now = new Date(nowTs);
            const futureDate = new Date(nowTs + offset);
            const entry: CacheEntry = {
              key: 'test',
              archivePath: '/test',
              createdAt: now.toISOString(),
              sizeBytes: 100,
              expiresAt: futureDate.toISOString(),
            };
            expect(isExpired(entry, now)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('entry with past expiresAt should be expired', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: minDate + 365 * 24 * 60 * 60 * 1000, max: maxDate }),
          fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }),
          (nowTs, offset) => {
            const now = new Date(nowTs);
            const pastDate = new Date(nowTs - offset);
            const entry: CacheEntry = {
              key: 'test',
              archivePath: '/test',
              createdAt: pastDate.toISOString(),
              sizeBytes: 100,
              expiresAt: pastDate.toISOString(),
            };
            expect(isExpired(entry, now)).toBe(true);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('filterValidEntries', () => {
    it('should only return non-expired entries', () => {
      fc.assert(
        fc.property(fc.array(cacheEntryArb), fc.date(), (entries, now) => {
          const valid = filterValidEntries(entries, now);
          valid.forEach(entry => {
            expect(isExpired(entry, now)).toBe(false);
          });
        }),
        { numRuns: 500 }
      );
    });

    it('filtered count should be <= original count', () => {
      fc.assert(
        fc.property(fc.array(cacheEntryArb), fc.date(), (entries, now) => {
          const valid = filterValidEntries(entries, now);
          expect(valid.length).toBeLessThanOrEqual(entries.length);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('getTotalCacheSize', () => {
    it('should sum all entry sizes', () => {
      fc.assert(
        fc.property(cacheIndexArb, index => {
          const total = getTotalCacheSize(index);
          const expected = index.entries.reduce((sum, e) => sum + e.sizeBytes, 0);
          expect(total).toBe(expected);
        }),
        { numRuns: 500 }
      );
    });

    it('empty index should have size 0', () => {
      const emptyIndex = createEmptyIndex();
      expect(getTotalCacheSize(emptyIndex)).toBe(0);
    });
  });

  describe('getEntriesByLRU', () => {
    it('should return entries sorted by access time ascending', () => {
      fc.assert(
        fc.property(cacheIndexArb, index => {
          const sorted = getEntriesByLRU(index);
          for (let i = 1; i < sorted.length; i++) {
            const prevTime = new Date(
              sorted[i - 1].accessedAt || sorted[i - 1].createdAt
            ).getTime();
            const currTime = new Date(sorted[i].accessedAt || sorted[i].createdAt).getTime();
            expect(prevTime).toBeLessThanOrEqual(currTime);
          }
        }),
        { numRuns: 500 }
      );
    });

    it('should return same number of entries as input', () => {
      fc.assert(
        fc.property(cacheIndexArb, index => {
          const sorted = getEntriesByLRU(index);
          expect(sorted.length).toBe(index.entries.length);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('migrateIndex', () => {
    it('should set version to current version', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: fc.constant('1'),
            entries: fc.array(
              cacheEntryArb.map(e => ({ ...e, accessedAt: undefined })),
              { maxLength: 50 }
            ),
          }),
          v1Index => {
            const migrated = migrateIndex(v1Index);
            expect(migrated.version).toBe('2');
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should set accessedAt for entries that lack it', () => {
      fc.assert(
        fc.property(
          fc.record({
            version: fc.constant('1'),
            entries: fc.array(
              cacheEntryArb.map(e => ({ ...e, accessedAt: undefined })),
              { maxLength: 50 }
            ),
          }),
          v1Index => {
            const migrated = migrateIndex(v1Index);
            migrated.entries.forEach((entry, i) => {
              expect(entry.accessedAt).toBe(v1Index.entries[i].createdAt);
            });
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('resolveKey', () => {
    it('exact match should return isExactMatch true', () => {
      // Create entries without expiration to avoid timing issues
      // (resolveKey uses new Date() internally)
      const nonExpiringEntryArb = fc.record({
        key: fc.string({ minLength: 1 }),
        archivePath: fc.string({ minLength: 1 }),
        createdAt: isoDateArb,
        sizeBytes: fc.nat({ max: 1_000_000_000 }),
        expiresAt: fc.constant(undefined),
        accessedAt: fc.option(isoDateArb, { nil: undefined }),
      });

      const nonExpiringIndexArb = fc.record({
        version: fc.constant('2'),
        entries: fc.array(nonExpiringEntryArb, { minLength: 1, maxLength: 100 }),
      });

      fc.assert(
        fc.property(nonExpiringIndexArb, fc.nat(), (index, randomIndex) => {
          const targetEntry = index.entries[randomIndex % index.entries.length];
          const result = resolveKey(index, targetEntry.key, []);

          expect(result.isExactMatch).toBe(true);
          expect(result.matchedKey).toBe(targetEntry.key);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('no match should return undefined entry', () => {
      fc.assert(
        fc.property(cacheIndexArb, fc.uuid(), (index, randomKey) => {
          // Ensure this key doesn't exist
          const keyExists = index.entries.some(
            e => e.key === randomKey || e.key.startsWith(randomKey)
          );
          if (keyExists) return true;

          const result = resolveKey(index, randomKey, []);
          expect(result.entry).toBeUndefined();
          expect(result.isExactMatch).toBe(false);
          return true;
        }),
        { numRuns: 500 }
      );
    });

    it('restore keys should find prefix matches', () => {
      // Create entries without expiration to avoid timing issues
      // (resolveKey uses new Date() internally)
      const nonExpiringEntryArb = fc.record({
        key: fc.string({ minLength: 1 }),
        archivePath: fc.string({ minLength: 1 }),
        createdAt: isoDateArb,
        sizeBytes: fc.nat({ max: 1_000_000_000 }),
        expiresAt: fc.constant(undefined),
        accessedAt: fc.option(isoDateArb, { nil: undefined }),
      });

      const nonExpiringIndexArb = fc.record({
        version: fc.constant('2'),
        entries: fc.array(nonExpiringEntryArb, { minLength: 1, maxLength: 100 }),
      });

      fc.assert(
        fc.property(nonExpiringIndexArb, fc.nat(), (index, randomIndex) => {
          const targetEntry = index.entries[randomIndex % index.entries.length];
          const prefix = targetEntry.key.slice(0, Math.max(1, targetEntry.key.length - 1));

          // Use a key that definitely doesn't exist for primary
          const result = resolveKey(index, 'definitely-not-a-real-key-12345', [prefix]);

          if (result.entry) {
            expect(result.isExactMatch).toBe(false);
            expect(result.entry.key.startsWith(prefix)).toBe(true);
          }
          return true;
        }),
        { numRuns: 500 }
      );
    });
  });
});

describe('Compression Fuzz Tests', () => {
  describe('getCompressionMethodFromPath', () => {
    it('should handle arbitrary file paths without crashing', () => {
      fc.assert(
        fc.property(fc.string(), path => {
          const method = getCompressionMethodFromPath(path);
          expect(['zstd', 'gzip', 'none']).toContain(method);
        }),
        { numRuns: 1000 }
      );
    });

    it('should detect zstd for paths ending in .tar.zst or .zst', () => {
      fc.assert(
        fc.property(fc.string(), prefix => {
          expect(getCompressionMethodFromPath(`${prefix}.tar.zst`)).toBe('zstd');
          expect(getCompressionMethodFromPath(`${prefix}.zst`)).toBe('zstd');
        }),
        { numRuns: 500 }
      );
    });

    it('should detect gzip for paths ending in .tar.gz or .gz', () => {
      fc.assert(
        fc.property(fc.string(), prefix => {
          expect(getCompressionMethodFromPath(`${prefix}.tar.gz`)).toBe('gzip');
          expect(getCompressionMethodFromPath(`${prefix}.gz`)).toBe('gzip');
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('getArchiveExtension', () => {
    it('should return valid extensions for all methods', () => {
      const methods = ['zstd', 'gzip', 'none'] as const;
      methods.forEach(method => {
        const ext = getArchiveExtension(method);
        expect(typeof ext).toBe('string');
        expect(ext.startsWith('.')).toBe(true);
      });
    });

    it('roundtrip: getCompressionMethodFromPath(getArchiveExtension(method)) should return method', () => {
      const methods = ['zstd', 'gzip'] as const; // 'none' returns .tar which doesn't roundtrip
      methods.forEach(method => {
        const ext = getArchiveExtension(method);
        const detected = getCompressionMethodFromPath(`archive${ext}`);
        expect(detected).toBe(method);
      });
    });
  });
});

describe('Edge Case Fuzz Tests', () => {
  describe('special characters in keys', () => {
    it('should handle unicode characters in keys', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, unit: 'grapheme' }), isoDateArb, (key, createdAt) => {
          const entry: CacheEntry = {
            key,
            archivePath: '/test',
            createdAt,
            sizeBytes: 100,
          };
          const index = addEntry(createEmptyIndex(), entry);
          const found = findEntry(index, key);
          expect(found?.key).toBe(key);
        }),
        { numRuns: 500 }
      );
    });

    it('should handle special characters in keys', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, unit: 'binary' }), isoDateArb, (key, createdAt) => {
          const entry: CacheEntry = {
            key,
            archivePath: '/test',
            createdAt,
            sizeBytes: 100,
          };
          const index = addEntry(createEmptyIndex(), entry);
          const found = findEntry(index, key);
          expect(found?.key).toBe(key);
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('boundary values', () => {
    it('should handle maximum size bytes', () => {
      fc.assert(
        fc.property(fc.nat({ max: Number.MAX_SAFE_INTEGER }), isoDateArb, (size, createdAt) => {
          const entry: CacheEntry = {
            key: 'test',
            archivePath: '/test',
            createdAt,
            sizeBytes: size,
          };
          const index = addEntry(createEmptyIndex(), entry);
          expect(getTotalCacheSize(index)).toBe(size);
        }),
        { numRuns: 200 }
      );
    });

    it('should handle empty strings as restore keys', () => {
      // Create entries without expiration to avoid timing issues
      // (resolveKey uses new Date() internally)
      const nonExpiringEntryArb = fc.record({
        key: fc.string({ minLength: 1 }),
        archivePath: fc.string({ minLength: 1 }),
        createdAt: isoDateArb,
        sizeBytes: fc.nat({ max: 1_000_000_000 }),
        expiresAt: fc.constant(undefined),
        accessedAt: fc.option(isoDateArb, { nil: undefined }),
      });

      const nonExpiringIndexArb = fc.record({
        version: fc.constant('2'),
        entries: fc.array(nonExpiringEntryArb, { minLength: 1, maxLength: 100 }),
      });

      fc.assert(
        fc.property(nonExpiringIndexArb, index => {
          // Empty restore key should match all entries as prefix
          const result = resolveKey(index, 'nonexistent-primary-key', ['']);
          // With non-expiring entries, should always find one
          expect(result.entry).toBeDefined();
        }),
        { numRuns: 200 }
      );
    });
  });
});
