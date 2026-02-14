import * as path from 'path';
import {
  LocalStorageProvider,
  createLocalStorageProvider,
} from '../../../src/storage/local/localProvider';
import { CacheEntry } from '../../../src/keyResolver/indexManager';

// Mock dependencies before importing them
jest.mock('fs');
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
}));
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/storage/local/localBackend', () => ({
  createLocalStorageBackend: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(true),
    getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
    ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
    getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
    delete: jest.fn().mockResolvedValue(undefined),
  })),
  LocalStorageBackend: jest.fn(),
}));

jest.mock('../../../src/storage/local/fileIndexStore', () => ({
  createFileIndexStore: jest.fn(() => ({
    load: jest.fn().mockResolvedValue({
      version: '2',
      entries: [],
    }),
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../src/storage/local/fileLockManager', () => ({
  createFileLockManager: jest.fn(() => ({
    withLock: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));

jest.mock('../../../src/storage/local/manifestStore', () => ({
  entryToManifest: jest.fn((entry: CacheEntry, compression: string) => ({
    version: '1',
    key: entry.key,
    createdAt: entry.createdAt,
    sizeBytes: entry.sizeBytes,
    archiveFilename: path.basename(entry.archivePath),
    compressionMethod: compression,
    accessedAt: entry.accessedAt,
  })),
  writeManifest: jest.fn().mockResolvedValue(undefined),
  deleteManifest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/archive/tar', () => ({
  createArchive: jest.fn().mockResolvedValue({
    archivePath: '/test/cache/archives/sha256-abc123.tar.zst',
    sizeBytes: 1000,
    compressionMethod: 'zstd',
  }),
  extractArchive: jest.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs';
import * as core from '@actions/core';
import { createLocalStorageBackend } from '../../../src/storage/local/localBackend';
import { createFileIndexStore } from '../../../src/storage/local/fileIndexStore';
import { createArchive, extractArchive } from '../../../src/archive/tar';
import { writeManifest, deleteManifest } from '../../../src/storage/local/manifestStore';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockCore = core as jest.Mocked<typeof core>;
const mockCreateLocalStorageBackend = createLocalStorageBackend as jest.Mock;
const mockCreateFileIndexStore = createFileIndexStore as jest.Mock;
const mockCreateArchive = createArchive as jest.Mock;
const mockExtractArchive = extractArchive as jest.Mock;
const mockWriteManifest = writeManifest as jest.Mock;
const mockDeleteManifest = deleteManifest as jest.Mock;

describe('LocalStorageProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLocalStorageProvider', () => {
    it('creates provider', () => {
      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('creates provider with options', () => {
      const provider = createLocalStorageProvider('/cache', 'owner', 'repo', {
        ttlDays: 7,
        maxCacheSizeGb: 5,
      });

      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });
  });

  describe('restore', () => {
    it('extracts archive when exists', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn(() => '/test/cache/archives/test.tar.zst'),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      await provider.restore(entry);

      expect(mockExtractArchive).toHaveBeenCalledWith(
        '/test/cache/archives/test.tar.zst',
        process.cwd()
      );
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Extracting cache'));
      expect(mockCore.info).toHaveBeenCalledWith('Cache restored successfully');
    });

    it('throws when archive not found', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(false),
        getFullPath: jest.fn(() => '/test/cache/archives/missing.tar.zst'),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/missing.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      await expect(provider.restore(entry)).rejects.toThrow('Cache archive not found');
    });
  });

  describe('save', () => {
    it('saves new cache entry', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');
      const entry = await provider.save('test-key', ['/path/to/file']);

      expect(entry.key).toBe('test-key');
      expect(entry.sizeBytes).toBe(1000);
      expect(mockCreateArchive).toHaveBeenCalled();
      expect(mockWriteManifest).toHaveBeenCalled();
      expect(mockIndexStore.save).toHaveBeenCalled();
    });

    it('returns existing entry if key already exists', async () => {
      const existingEntry: CacheEntry = {
        key: 'existing-key',
        archivePath: 'archives/existing.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 500,
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [existingEntry],
        }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');
      const entry = await provider.save('existing-key', ['/path/to/file']);

      expect(entry).toEqual(existingEntry);
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('already exists'));
      expect(mockFs.unlinkSync).toHaveBeenCalled(); // Temp file cleanup
    });

    it('cleans up temp archive on rename failure', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const renameError = new Error('Rename failed');
      mockFs.renameSync.mockImplementation(() => {
        throw renameError;
      });
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      await expect(provider.save('test-key', ['/path/to/file'])).rejects.toThrow(
        'Failed to rename archive'
      );

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('ignores cleanup errors on rename failure', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const renameError = new Error('Rename failed');
      mockFs.renameSync.mockImplementation(() => {
        throw renameError;
      });
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      await expect(provider.save('test-key', ['/path/to/file'])).rejects.toThrow(
        'Failed to rename archive'
      );
    });

    it('rolls back on index save error', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockRejectedValue(new Error('Index save failed')),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      await expect(provider.save('test-key', ['/path/to/file'])).rejects.toThrow(
        'Index save failed'
      );

      // Should clean up finalized archive and manifest
      expect(mockFs.unlinkSync).toHaveBeenCalled();
      expect(mockDeleteManifest).toHaveBeenCalled();
    });

    it('rolls back on manifest write error', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockWriteManifest.mockRejectedValueOnce(new Error('Manifest write failed'));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      await expect(provider.save('test-key', ['/path/to/file'])).rejects.toThrow(
        'Manifest write failed'
      );

      // Should clean up finalized archive
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('ignores rollback cleanup errors', async () => {
      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn(),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({ version: '2', entries: [] }),
        save: jest.fn().mockRejectedValue(new Error('Index save failed')),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo');

      await expect(provider.save('test-key', ['/path/to/file'])).rejects.toThrow(
        'Index save failed'
      );
    });

    it('deletes evicted entries after save', async () => {
      const evictedEntry: CacheEntry = {
        key: 'old-key',
        archivePath: 'archives/old.tar.zst',
        createdAt: '2023-01-01T00:00:00.000Z',
        sizeBytes: 500,
        accessedAt: '2023-01-01T00:00:00.000Z',
      };

      const mockBackend = {
        exists: jest.fn().mockResolvedValue(true),
        getFullPath: jest.fn((loc: string) => `/test/cache/${loc}`),
        ensureArchivesDir: jest.fn().mockResolvedValue('/test/cache/archives'),
        getArchivesDir: jest.fn().mockReturnValue('/test/cache/archives'),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateLocalStorageBackend.mockReturnValueOnce(mockBackend);

      const mockIndexStore = {
        load: jest.fn().mockResolvedValue({
          version: '2',
          entries: [evictedEntry],
        }),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockCreateFileIndexStore.mockReturnValueOnce(mockIndexStore);

      mockFs.renameSync.mockImplementation(() => {});
      mockFs.unlinkSync.mockImplementation(() => {});

      const provider = createLocalStorageProvider('/cache', 'owner', 'repo', {
        maxCacheSizeGb: 0.000001, // Very small to force eviction
      });

      await provider.save('test-key', ['/path/to/file']);

      // Should delete evicted entry
      expect(mockBackend.delete).toHaveBeenCalledWith(evictedEntry.archivePath);
      expect(mockCore.info).toHaveBeenCalledWith(expect.stringContaining('Will evict'));
    });
  });
});
