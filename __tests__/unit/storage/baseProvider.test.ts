import { BaseStorageProvider, formatBytes } from '../../../src/storage/baseProvider';
import { StorageBackend, IndexStore, LockManager } from '../../../src/storage/interfaces';
import { CacheEntry, CacheIndex } from '../../../src/keyResolver/indexManager';

// Mock dependencies
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
}));

import * as core from '@actions/core';

const mockCore = core as jest.Mocked<typeof core>;

// Test implementation of BaseStorageProvider
class TestStorageProvider extends BaseStorageProvider {
  async restore(_entry: CacheEntry): Promise<void> {
    // Test implementation
  }

  async save(_key: string, _paths: string[]): Promise<CacheEntry> {
    // Test implementation
    return {
      key: _key,
      archivePath: 'archives/test.tar.zst',
      createdAt: new Date().toISOString(),
      sizeBytes: 1000,
    };
  }
}

describe('BaseStorageProvider', () => {
  let mockBackend: jest.Mocked<StorageBackend>;
  let mockIndexStore: jest.Mocked<IndexStore>;
  let mockLockManager: jest.Mocked<LockManager>;
  let provider: TestStorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBackend = {
      put: jest.fn().mockResolvedValue('archives/test.tar.zst'),
      get: jest.fn().mockResolvedValue(Buffer.from('test')),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
      getSize: jest.fn().mockResolvedValue(1000),
    };

    mockIndexStore = {
      load: jest.fn().mockResolvedValue({
        version: '2',
        entries: [],
      } as CacheIndex),
      save: jest.fn().mockResolvedValue(undefined),
    };

    mockLockManager = {
      withLock: jest.fn(<T>(fn: () => Promise<T>) => fn()),
    } as jest.Mocked<LockManager>;

    provider = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager);
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
      expect(formatBytes(512)).toBe('512 Bytes');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(2048)).toBe('2 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });

    it('formats with decimal precision', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('resolve', () => {
    it('resolves exact match', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [entry],
      });

      const result = await provider.resolve('test-key', []);

      expect(result.entry).toEqual(entry);
      expect(result.isExactMatch).toBe(true);
      expect(result.matchedKey).toBe('test-key');
    });

    it('uses lock manager', async () => {
      await provider.resolve('test-key', []);

      expect(mockLockManager.withLock).toHaveBeenCalled();
    });
  });

  describe('exists', () => {
    it('returns true for existing non-expired entry', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [entry],
      });

      const result = await provider.exists('test-key');

      expect(result).toBe(true);
    });

    it('returns false for expired entry', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        expiresAt: '2023-12-31T23:59:59.999Z', // Expired
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [entry],
      });

      const result = await provider.exists('test-key');

      expect(result).toBe(false);
    });

    it('returns false for missing entry', async () => {
      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [],
      });

      const result = await provider.exists('missing-key');

      expect(result).toBe(false);
    });
  });

  describe('getIndex', () => {
    it('returns index from store', async () => {
      const index: CacheIndex = {
        version: '2',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 1000,
          },
        ],
      };

      mockIndexStore.load.mockResolvedValue(index);

      const result = await provider.getIndex();

      expect(result).toEqual(index);
      expect(mockLockManager.withLock).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('removes expired entries and deletes archives', async () => {
      const validEntry: CacheEntry = {
        key: 'valid-key',
        archivePath: 'archives/valid.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      const expiredEntry: CacheEntry = {
        key: 'expired-key',
        archivePath: 'archives/expired.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 500,
        expiresAt: '2023-12-31T23:59:59.999Z',
      };

      const index: CacheIndex = {
        version: '2',
        entries: [validEntry, expiredEntry],
      };

      const result = await (provider as any).cleanupExpiredEntries(index);

      expect(result.deletedCount).toBe(1);
      expect(result.index.entries).toHaveLength(1);
      expect(result.index.entries[0].key).toBe('valid-key');
      expect(mockBackend.delete).toHaveBeenCalledWith('archives/expired.tar.zst');
    });

    it('handles archive delete errors gracefully', async () => {
      const expiredEntry: CacheEntry = {
        key: 'expired-key',
        archivePath: 'archives/expired.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 500,
        expiresAt: '2023-12-31T23:59:59.999Z',
      };

      const index: CacheIndex = {
        version: '2',
        entries: [expiredEntry],
      };

      mockBackend.delete.mockRejectedValue(new Error('Delete failed'));

      const result = await (provider as any).cleanupExpiredEntries(index);

      expect(result.deletedCount).toBe(1);
      expect(result.index.entries).toHaveLength(0);
      expect(mockCore.debug).toHaveBeenCalledWith(expect.stringContaining('Failed to delete archive'));
    });

    it('skips delete if archive does not exist', async () => {
      const expiredEntry: CacheEntry = {
        key: 'expired-key',
        archivePath: 'archives/expired.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 500,
        expiresAt: '2023-12-31T23:59:59.999Z',
      };

      const index: CacheIndex = {
        version: '2',
        entries: [expiredEntry],
      };

      mockBackend.exists.mockResolvedValue(false);

      const result = await (provider as any).cleanupExpiredEntries(index);

      expect(result.deletedCount).toBe(1);
      expect(mockBackend.delete).not.toHaveBeenCalled();
    });
  });

  describe('evictToSize', () => {
    it('returns unchanged index when under target', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      const index: CacheIndex = {
        version: '2',
        entries: [entry],
      };

      const result = await (provider as any).evictToSize(index, 5000);

      expect(result.index.entries).toHaveLength(1);
      expect(result.toDelete).toHaveLength(0);
    });

    it('evicts LRU entries to reach target size', async () => {
      const oldEntry: CacheEntry = {
        key: 'old-key',
        archivePath: 'archives/old.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        accessedAt: '2023-01-01T00:00:00.000Z',
      };

      const newEntry: CacheEntry = {
        key: 'new-key',
        archivePath: 'archives/new.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      const index: CacheIndex = {
        version: '2',
        entries: [oldEntry, newEntry],
      };

      const result = await (provider as any).evictToSize(index, 1500);

      expect(result.index.entries).toHaveLength(1);
      expect(result.index.entries[0].key).toBe('new-key');
      expect(result.toDelete).toHaveLength(1);
      expect(result.toDelete[0].key).toBe('old-key');
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Will evict 1 entries'));
    });
  });

  describe('deleteEvictedEntries', () => {
    it('deletes archives for evicted entries', async () => {
      const entries: CacheEntry[] = [
        {
          key: 'evicted-1',
          archivePath: 'archives/evicted-1.tar.zst',
          createdAt: '2024-01-01T00:00:00.000Z',
          sizeBytes: 1000,
        },
        {
          key: 'evicted-2',
          archivePath: 'archives/evicted-2.tar.zst',
          createdAt: '2024-01-01T00:00:00.000Z',
          sizeBytes: 2000,
        },
      ];

      await (provider as any).deleteEvictedEntries(entries);

      expect(mockBackend.delete).toHaveBeenCalledTimes(2);
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Evicted cache entry (LRU): evicted-1'));
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Evicted cache entry (LRU): evicted-2'));
    });

    it('handles delete errors gracefully', async () => {
      const entry: CacheEntry = {
        key: 'evicted',
        archivePath: 'archives/evicted.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockBackend.delete.mockRejectedValue(new Error('Delete failed'));

      await (provider as any).deleteEvictedEntries([entry]);

      expect(mockCore.debug).toHaveBeenCalledWith(expect.stringContaining('Failed to delete evicted archive'));
    });
  });

  describe('maybeEvict', () => {
    it('returns unchanged when no max size configured', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      const index: CacheIndex = {
        version: '2',
        entries: [entry],
      };

      const providerNoLimit = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager, {
        maxCacheSizeGb: 0,
      });

      const result = await (providerNoLimit as any).maybeEvict(index, 5000);

      expect(result.toDelete).toHaveLength(0);
    });

    it('warns when single entry exceeds max size', async () => {
      const index: CacheIndex = {
        version: '2',
        entries: [],
      };

      const providerWithLimit = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager, {
        maxCacheSizeGb: 0.001, // ~1MB
      });

      const result = await (providerWithLimit as any).maybeEvict(index, 10 * 1024 * 1024); // 10MB entry

      expect(result.toDelete).toHaveLength(0);
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Cache entry')
      );
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('exceeds max cache size')
      );
    });

    it('evicts when new entry would exceed limit', async () => {
      const oldEntry: CacheEntry = {
        key: 'old-key',
        archivePath: 'archives/old.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        accessedAt: '2023-01-01T00:00:00.000Z',
      };

      const index: CacheIndex = {
        version: '2',
        entries: [oldEntry],
      };

      const providerWithLimit = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager, {
        maxCacheSizeGb: 0.000001, // Very small
      });

      const result = await (providerWithLimit as any).maybeEvict(index, 500);

      expect(result.toDelete.length).toBeGreaterThan(0);
    });
  });

  describe('calculateExpiresAt', () => {
    it('returns undefined when no TTL configured', () => {
      const providerNoTTL = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager);

      const result = (providerNoTTL as any).calculateExpiresAt();

      expect(result).toBeUndefined();
    });

    it('returns undefined when TTL is 0', () => {
      const providerZeroTTL = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager, {
        ttlDays: 0,
      });

      const result = (providerZeroTTL as any).calculateExpiresAt();

      expect(result).toBeUndefined();
    });

    it('calculates expiration date from TTL', () => {
      const providerWithTTL = new TestStorageProvider(mockBackend, mockIndexStore, mockLockManager, {
        ttlDays: 7,
      });

      const result = (providerWithTTL as any).calculateExpiresAt();

      expect(result).toBeDefined();
      const expiresDate = new Date(result!);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 7);

      // Allow 1 second tolerance for test execution time
      const diff = Math.abs(expiresDate.getTime() - expectedDate.getTime());
      expect(diff).toBeLessThan(1000);
    });
  });

  describe('updateAccessTimeForEntry', () => {
    it('updates access time for existing entry', async () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [entry],
      });

      await (provider as any).updateAccessTimeForEntry('test-key');

      expect(mockIndexStore.save).toHaveBeenCalled();
      const savedIndex = mockIndexStore.save.mock.calls[0][0] as CacheIndex;
      expect(savedIndex.entries[0].accessedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });

    it('handles errors gracefully', async () => {
      mockIndexStore.load.mockRejectedValue(new Error('Load failed'));

      await (provider as any).updateAccessTimeForEntry('test-key');

      expect(mockCore.debug).toHaveBeenCalledWith(expect.stringContaining('Failed to update accessedAt'));
    });
  });

  describe('addEntryToIndex', () => {
    it('adds new entry to index', async () => {
      const newEntry: CacheEntry = {
        key: 'new-key',
        archivePath: 'archives/new.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [],
      });

      await (provider as any).addEntryToIndex(newEntry);

      expect(mockIndexStore.save).toHaveBeenCalled();
      const savedIndex = mockIndexStore.save.mock.calls[0][0] as CacheIndex;
      expect(savedIndex.entries).toHaveLength(1);
      expect(savedIndex.entries[0].key).toBe('new-key');
    });

    it('does not add duplicate entry', async () => {
      const existingEntry: CacheEntry = {
        key: 'existing-key',
        archivePath: 'archives/existing.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [existingEntry],
      });

      await (provider as any).addEntryToIndex(existingEntry);

      expect(mockIndexStore.save).not.toHaveBeenCalled();
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    });

    it('cleans up expired entries before adding', async () => {
      const expiredEntry: CacheEntry = {
        key: 'expired-key',
        archivePath: 'archives/expired.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 500,
        expiresAt: '2023-12-31T23:59:59.999Z',
      };

      const newEntry: CacheEntry = {
        key: 'new-key',
        archivePath: 'archives/new.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      mockIndexStore.load.mockResolvedValue({
        version: '2',
        entries: [expiredEntry],
      });

      await (provider as any).addEntryToIndex(newEntry);

      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Cleaned up 1 expired cache entries'));
    });
  });

  describe('deleteManifestIfLocal', () => {
    it('does not delete manifest for non-local backend', async () => {
      await (provider as any).deleteManifestIfLocal('archives/test.tar.zst');

      // Should not throw or call deleteManifest
      expect(mockCore.debug).not.toHaveBeenCalledWith(expect.stringContaining('Failed to delete manifest'));
    });
  });
});
