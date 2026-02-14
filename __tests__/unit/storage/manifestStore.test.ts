import * as path from 'path';
import {
  ArchiveManifest,
  entryToManifest,
  manifestToEntry,
  getManifestPath,
  writeManifest,
  readManifest,
  deleteManifest,
} from '../../../src/storage/local/manifestStore';
import { CacheEntry } from '../../../src/keyResolver/indexManager';
import { MANIFEST_VERSION, ARCHIVES_DIR } from '../../../src/constants';

// Mock dependencies before importing them
jest.mock('fs');
jest.mock('@actions/core', () => ({
  debug: jest.fn(),
  warning: jest.fn(),
}));

import * as fs from 'fs';
import * as core from '@actions/core';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockCore = core as jest.Mocked<typeof core>;

describe('manifestStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('entryToManifest', () => {
    it('converts cache entry to manifest', () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/sha256-abc123.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        accessedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: '2024-12-31T23:59:59.999Z',
      };

      const manifest = entryToManifest(entry, 'zstd');

      expect(manifest).toEqual({
        version: MANIFEST_VERSION,
        key: 'test-key',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        archiveFilename: 'sha256-abc123.tar.zst',
        compressionMethod: 'zstd',
        expiresAt: '2024-12-31T23:59:59.999Z',
        accessedAt: '2024-01-02T00:00:00.000Z',
      });
    });

    it('uses createdAt as accessedAt when accessedAt is missing', () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'archives/test.tar.zst',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      const manifest = entryToManifest(entry, 'gzip');

      expect(manifest.accessedAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('extracts basename from archive path', () => {
      const entry: CacheEntry = {
        key: 'test-key',
        archivePath: 'some/nested/path/archive.tar.gz',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
      };

      const manifest = entryToManifest(entry, 'gzip');

      expect(manifest.archiveFilename).toBe('archive.tar.gz');
    });
  });

  describe('manifestToEntry', () => {
    it('converts manifest to cache entry', () => {
      const manifest: ArchiveManifest = {
        version: MANIFEST_VERSION,
        key: 'test-key',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        archiveFilename: 'sha256-abc123.tar.zst',
        compressionMethod: 'zstd',
        expiresAt: '2024-12-31T23:59:59.999Z',
        accessedAt: '2024-01-02T00:00:00.000Z',
      };

      const entry = manifestToEntry(manifest, '/cache/dir');

      expect(entry).toEqual({
        key: 'test-key',
        archivePath: path.join(ARCHIVES_DIR, 'sha256-abc123.tar.zst'),
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        expiresAt: '2024-12-31T23:59:59.999Z',
        accessedAt: '2024-01-02T00:00:00.000Z',
      });
    });

    it('handles manifest without optional fields', () => {
      const manifest: ArchiveManifest = {
        version: MANIFEST_VERSION,
        key: 'test-key',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        archiveFilename: 'test.tar.gz',
        compressionMethod: 'gzip',
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      const entry = manifestToEntry(manifest, '/cache/dir');

      expect(entry.expiresAt).toBeUndefined();
    });
  });

  describe('getManifestPath', () => {
    it('returns manifest path for .tar.zst archive', () => {
      const archivePath = '/cache/archives/sha256-abc123.tar.zst';

      const manifestPath = getManifestPath(archivePath);

      expect(manifestPath).toBe('/cache/archives/sha256-abc123.meta.json');
    });

    it('returns manifest path for .tar.gz archive', () => {
      const archivePath = '/cache/archives/sha256-xyz789.tar.gz';

      const manifestPath = getManifestPath(archivePath);

      expect(manifestPath).toBe('/cache/archives/sha256-xyz789.meta.json');
    });

    it('returns manifest path for .tar archive', () => {
      const archivePath = '/cache/archives/sha256-def456.tar';

      const manifestPath = getManifestPath(archivePath);

      expect(manifestPath).toBe('/cache/archives/sha256-def456.meta.json');
    });

    it('handles .tar.bz2 archive', () => {
      const archivePath = '/cache/archives/archive.tar.bz2';

      const manifestPath = getManifestPath(archivePath);

      expect(manifestPath).toBe('/cache/archives/archive.meta.json');
    });
  });

  describe('writeManifest', () => {
    const archivePath = '/cache/archives/test.tar.zst';
    const manifest: ArchiveManifest = {
      version: MANIFEST_VERSION,
      key: 'test-key',
      createdAt: '2024-01-01T00:00:00.000Z',
      sizeBytes: 1000,
      archiveFilename: 'test.tar.zst',
      compressionMethod: 'zstd',
      accessedAt: '2024-01-01T00:00:00.000Z',
    };

    it('writes manifest atomically', async () => {
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await writeManifest(archivePath, manifest);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.renameSync).toHaveBeenCalled();
      expect(mockCore.debug).toHaveBeenCalledWith(expect.stringContaining('Wrote manifest'));
    });

    it('uses temp file with timestamp and pid', async () => {
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await writeManifest(archivePath, manifest);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const tempPath = writeCall[0] as string;

      expect(tempPath).toContain('.tmp.');
      expect(tempPath).toContain(process.pid.toString());
    });

    it('writes formatted JSON content', async () => {
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {});

      await writeManifest(archivePath, manifest);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(manifest);
      expect(content).toContain('\n'); // Check it's formatted with newlines
    });

    it('cleans up temp file on write error', async () => {
      const error = new Error('Write failed');
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await expect(writeManifest(archivePath, manifest)).rejects.toThrow(
        /Failed to write manifest/
      );

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('cleans up temp file on rename error', async () => {
      const error = new Error('Rename failed');
      mockFs.writeFileSync.mockImplementation(() => {});
      mockFs.renameSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await expect(writeManifest(archivePath, manifest)).rejects.toThrow(
        /Failed to write manifest/
      );

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('ignores cleanup errors', async () => {
      const writeError = new Error('Write failed');
      mockFs.writeFileSync.mockImplementation(() => {
        throw writeError;
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      await expect(writeManifest(archivePath, manifest)).rejects.toThrow(
        /Failed to write manifest/
      );
      await expect(writeManifest(archivePath, manifest)).rejects.toThrow(/Write failed/);
    });

    it('does not attempt cleanup if temp file does not exist', async () => {
      const error = new Error('Write failed');
      mockFs.writeFileSync.mockImplementation(() => {
        throw error;
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(writeManifest(archivePath, manifest)).rejects.toThrow();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('readManifest', () => {
    const archivePath = '/cache/archives/test.tar.zst';
    const validManifest: ArchiveManifest = {
      version: MANIFEST_VERSION,
      key: 'test-key',
      createdAt: '2024-01-01T00:00:00.000Z',
      sizeBytes: 1000,
      archiveFilename: 'test.tar.zst',
      compressionMethod: 'zstd',
      accessedAt: '2024-01-01T00:00:00.000Z',
    };

    it('reads valid manifest', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validManifest));

      const result = await readManifest(archivePath);

      expect(result).toEqual(validManifest);
    });

    it('returns undefined when manifest does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
    });

    it('returns undefined and warns on invalid JSON', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json{{{');

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read manifest')
      );
    });

    it('returns undefined and warns on missing version field', async () => {
      const invalidManifest = {
        // version missing
        key: 'test-key',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        archiveFilename: 'test.tar.zst',
        compressionMethod: 'zstd',
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidManifest));

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Invalid manifest format')
      );
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Missing fields: version')
      );
    });

    it('returns undefined and warns on missing key field', async () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        // key missing
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        archiveFilename: 'test.tar.zst',
        compressionMethod: 'zstd',
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidManifest));

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('Missing fields: key'));
    });

    it('returns undefined and warns on missing archiveFilename field', async () => {
      const invalidManifest = {
        version: MANIFEST_VERSION,
        key: 'test-key',
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        // archiveFilename missing
        compressionMethod: 'zstd',
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidManifest));

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Missing fields: archiveFilename')
      );
    });

    it('returns undefined and warns on multiple missing fields', async () => {
      const invalidManifest = {
        // version, key, archiveFilename all missing
        createdAt: '2024-01-01T00:00:00.000Z',
        sizeBytes: 1000,
        compressionMethod: 'zstd',
        accessedAt: '2024-01-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidManifest));

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Missing fields: version, key, archiveFilename')
      );
    });

    it('returns undefined and warns on version mismatch', async () => {
      const futureManifest = {
        ...validManifest,
        version: '99',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(futureManifest));

      const result = await readManifest(archivePath);

      expect(result).toBeUndefined();
      expect(mockCore.warning).toHaveBeenCalledWith(
        expect.stringContaining('Incompatible manifest version: 99')
      );
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('expected: 2'));
    });

    it('includes manifest path in validation warnings', async () => {
      const invalidManifest = {
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidManifest));

      await readManifest(archivePath);

      const expectedManifestPath = getManifestPath(archivePath);
      expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining(expectedManifestPath));
    });
  });

  describe('deleteManifest', () => {
    const archivePath = '/cache/archives/test.tar.zst';

    it('deletes existing manifest', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await deleteManifest(archivePath);

      expect(mockFs.unlinkSync).toHaveBeenCalled();
      expect(mockCore.debug).toHaveBeenCalledWith(expect.stringContaining('Deleted manifest'));
    });

    it('does nothing if manifest does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await deleteManifest(archivePath);

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('logs error but does not throw on delete failure', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      await deleteManifest(archivePath);

      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete manifest')
      );
    });

    it('uses correct manifest path', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await deleteManifest(archivePath);

      const expectedManifestPath = getManifestPath(archivePath);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(expectedManifestPath);
    });
  });
});
