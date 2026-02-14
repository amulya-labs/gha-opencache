import * as path from 'path';
import { FileIndexStore } from '../../../src/storage/local/fileIndexStore';
import { CacheIndex } from '../../../src/keyResolver/indexManager';
import { INDEX_VERSION } from '../../../src/constants';

// Mock dependencies before importing them
jest.mock('fs');
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
}));

import * as fs from 'fs';
import * as io from '@actions/io';
import * as core from '@actions/core';
jest.mock('../../../src/storage/local/indexRebuilder', () => ({
  shouldRebuildIndex: jest.fn(() => false),
  rebuildIndexFromManifests: jest.fn().mockResolvedValue({
    version: '2',
    entries: [],
  }),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockIo = io as jest.Mocked<typeof io>;
const mockCore = core as jest.Mocked<typeof core>;

// Import mocked functions for type-safe access
import {
  shouldRebuildIndex,
  rebuildIndexFromManifests,
} from '../../../src/storage/local/indexRebuilder';
const mockShouldRebuildIndex = shouldRebuildIndex as jest.MockedFunction<typeof shouldRebuildIndex>;
const mockRebuildIndexFromManifests = rebuildIndexFromManifests as jest.MockedFunction<
  typeof rebuildIndexFromManifests
>;

describe('FileIndexStore', () => {
  const cacheDir = '/test/cache';
  const indexPath = path.join(cacheDir, 'index.json');
  let store: FileIndexStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new FileIndexStore(cacheDir);
  });

  describe('load', () => {
    it('loads valid index file', () => {
      const validIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 1000,
            accessedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validIndex));

      return expect(store.load()).resolves.toEqual(validIndex);
    });

    it('migrates v1 index to v2', async () => {
      const v1Index = {
        version: '1',
        entries: [
          {
            key: 'test-key',
            archivePath: 'archives/test.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 1000,
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(v1Index));

      const result = await store.load();

      expect(result.version).toBe(INDEX_VERSION);
      expect(result.entries[0].accessedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(mockCore.debug).toHaveBeenCalledWith('Migrating index from version 1 to version 2');
    });

    it('handles unknown future version by rebuilding from manifests', async () => {
      const futureIndex = {
        version: '99',
        entries: [],
      };

      const rebuiltIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'rebuilt-key',
            archivePath: 'archives/rebuilt.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 500,
            accessedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(futureIndex));
      mockRebuildIndexFromManifests.mockResolvedValue(rebuiltIndex);

      const result = await store.load();

      expect(result).toEqual(rebuiltIndex);
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Index version 99 is not recognized')
      );
      expect(mockRebuildIndexFromManifests).toHaveBeenCalledWith(cacheDir);
    });

    it('does not save empty rebuilt index for unknown version', async () => {
      const futureIndex = {
        version: '99',
        entries: [],
      };

      const emptyRebuiltIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(futureIndex));
      mockRebuildIndexFromManifests.mockResolvedValue(emptyRebuiltIndex);
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await store.load();

      // Verify save was not called (no writeFileSync after rebuild)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('handles ENOENT race condition during read', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      const result = await store.load();

      expect(result).toEqual({ version: INDEX_VERSION, entries: [] });
      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('Index file disappeared during read')
      );
    });

    it('throws on EACCES permission error with helpful message', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      await expect(store.load()).rejects.toThrow(/Permission denied reading cache index/);
      await expect(store.load()).rejects.toThrow(/Use the default cache path/);
    });

    it('throws on EPERM permission error with helpful message', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error: NodeJS.ErrnoException = new Error('Operation not permitted');
      error.code = 'EPERM';
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      await expect(store.load()).rejects.toThrow(/Permission denied reading cache index/);
    });

    it('throws on ENOSPC disk full error', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error: NodeJS.ErrnoException = new Error('No space left on device');
      error.code = 'ENOSPC';
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      await expect(store.load()).rejects.toThrow(/Disk full while reading cache index/);
    });

    it('throws on EIO I/O error', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error: NodeJS.ErrnoException = new Error('I/O error');
      error.code = 'EIO';
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      await expect(store.load()).rejects.toThrow(/I\/O error reading cache index/);
    });

    it('rebuilds from manifests on JSON parse error', async () => {
      const rebuiltIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'rebuilt-key',
            archivePath: 'archives/rebuilt.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 500,
            accessedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json{{{');
      mockRebuildIndexFromManifests.mockResolvedValue(rebuiltIndex);

      const result = await store.load();

      expect(result).toEqual(rebuiltIndex);
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Cache index at'));
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('is corrupted (invalid JSON)')
      );
    });

    it('logs content preview on JSON parse error', async () => {
      const corruptedContent = 'x'.repeat(300);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(corruptedContent);
      mockRebuildIndexFromManifests.mockResolvedValue({
        version: INDEX_VERSION,
        entries: [],
      });

      await store.load();

      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('Corrupted index length: 300 bytes')
      );
    });

    it('handles unknown error types', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const error = new Error('Unknown error');
      mockFs.readFileSync.mockImplementation(() => {
        throw error;
      });

      await expect(store.load()).rejects.toThrow(/Failed to load cache index from/);
    });

    it('rebuilds from manifests when file does not exist', async () => {
      const rebuiltIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'manifest-key',
            archivePath: 'archives/manifest.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 2000,
            accessedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(false);
      mockRebuildIndexFromManifests.mockResolvedValue(rebuiltIndex);

      const result = await store.load();

      expect(result).toEqual(rebuiltIndex);
      expect(mockCore.info).toHaveBeenCalledWith(
        'Rebuilt index from manifests (missing index.json)'
      );
    });

    it('returns empty index when no manifests found', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockRebuildIndexFromManifests.mockResolvedValue({
        version: INDEX_VERSION,
        entries: [],
      });

      const result = await store.load();

      expect(result).toEqual({ version: INDEX_VERSION, entries: [] });
      expect(mockCore.debug).toHaveBeenCalledWith('No manifests found, returning empty index');
    });

    it('handles manual rebuild request', async () => {
      const rebuiltIndex: CacheIndex = {
        version: INDEX_VERSION,
        entries: [
          {
            key: 'manual-rebuild',
            archivePath: 'archives/manual.tar.zst',
            createdAt: '2024-01-01T00:00:00.000Z',
            sizeBytes: 1500,
            accessedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };

      mockShouldRebuildIndex.mockReturnValue(true);
      mockRebuildIndexFromManifests.mockResolvedValue(rebuiltIndex);
      mockIo.mkdirP.mockResolvedValue();
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      const result = await store.load();

      expect(result).toEqual(rebuiltIndex);
      expect(mockCore.info).toHaveBeenCalledWith(
        'Manual index rebuild requested (OPENCACHE_REBUILD_INDEX=1)'
      );
      expect(mockRebuildIndexFromManifests).toHaveBeenCalledWith(cacheDir);
    });
  });

  describe('save', () => {
    const testIndex: CacheIndex = {
      version: INDEX_VERSION,
      entries: [
        {
          key: 'test-key',
          archivePath: 'archives/test.tar.zst',
          createdAt: '2024-01-01T00:00:00.000Z',
          sizeBytes: 1000,
          accessedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    };

    it('saves index successfully', async () => {
      mockIo.mkdirP.mockResolvedValue();
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await store.save(testIndex);

      expect(mockIo.mkdirP).toHaveBeenCalledWith(cacheDir);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.renameSync).toHaveBeenCalled();
      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('Successfully saved cache index')
      );
    });

    it('uses atomic write with temp file', async () => {
      mockIo.mkdirP.mockResolvedValue();
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await store.save(testIndex);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const tempPath = writeCall[0] as string;

      expect(tempPath).toContain('.tmp.');
      expect(tempPath).toContain(process.pid.toString());

      const renameCall = mockFs.renameSync.mock.calls[0];
      expect(renameCall[0]).toBe(tempPath);
      expect(renameCall[1]).toBe(indexPath);
    });

    it('cleans up temp file on write error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const writeError = new Error('Write failed');
      mockFs.writeFileSync.mockImplementation(() => {
        throw writeError;
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await expect(store.save(testIndex)).rejects.toThrow();

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('ignores temp file cleanup errors', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const writeError = new Error('Write failed');
      mockFs.writeFileSync.mockImplementation(() => {
        throw writeError;
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      await expect(store.save(testIndex)).rejects.toThrow('Write failed');
    });

    it('throws on EACCES permission error with helpful message', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/Permission denied writing cache index/);
      await expect(store.save(testIndex)).rejects.toThrow(/Use the default cache path/);
    });

    it('throws on EPERM permission error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error: NodeJS.ErrnoException = new Error('Operation not permitted');
      error.code = 'EPERM';
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/Permission denied writing cache index/);
    });

    it('throws on ENOSPC disk full error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error: NodeJS.ErrnoException = new Error('No space left on device');
      error.code = 'ENOSPC';
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/Disk full while writing cache index/);
    });

    it('throws on EIO I/O error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error: NodeJS.ErrnoException = new Error('I/O error');
      error.code = 'EIO';
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/I\/O error writing cache index/);
    });

    it('throws on EROFS read-only filesystem error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error: NodeJS.ErrnoException = new Error('Read-only filesystem');
      error.code = 'EROFS';
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/Read-only filesystem/);
    });

    it('throws on unknown save error', async () => {
      mockIo.mkdirP.mockResolvedValue();
      const error = new Error('Unknown save error');
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(store.save(testIndex)).rejects.toThrow(/Failed to save cache index/);
    });

    it('does not clean up temp file after successful rename', async () => {
      mockIo.mkdirP.mockResolvedValue();
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});
      mockFs.existsSync.mockReturnValue(false);

      await store.save(testIndex);

      // unlinkSync should not be called after successful rename
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
