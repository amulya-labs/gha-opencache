import * as path from 'path';
import { Readable } from 'stream';
import { LocalStorageBackend } from '../../../src/storage/local/localBackend';
import { ARCHIVES_DIR } from '../../../src/constants';

// Mock dependencies before importing them
jest.mock('fs');
jest.mock('@actions/io', () => ({
  mkdirP: jest.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs';
import * as io from '@actions/io';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockIo = io as jest.Mocked<typeof io>;

describe('LocalStorageBackend', () => {
  const cacheDir = '/test/cache';
  const archivesDir = path.join(cacheDir, ARCHIVES_DIR);
  let backend: LocalStorageBackend;

  beforeEach(() => {
    jest.clearAllMocks();
    backend = new LocalStorageBackend(cacheDir);
  });

  describe('put', () => {
    it('stores buffer data', async () => {
      const data = Buffer.from('test data');
      mockFs.writeFileSync.mockImplementation(() => {});

      const location = await backend.put('test-key', data);

      expect(location).toContain(ARCHIVES_DIR);
      expect(location).toContain('sha256-');
      expect(location).toContain('.tar.zst');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('generates hash-based filename for buffer', async () => {
      const data = Buffer.from('test data');
      mockFs.writeFileSync.mockImplementation(() => {});

      const location = await backend.put('test-key', data);
      const filename = path.basename(location);

      expect(filename).toMatch(/^sha256-[a-f0-9]{16}\.tar\.zst$/);
    });

    it('stores stream data by collecting chunks', async () => {
      const chunks = [Buffer.from('chunk1'), Buffer.from('chunk2'), Buffer.from('chunk3')];
      const stream = Readable.from(chunks);
      mockFs.writeFileSync.mockImplementation(() => {});

      const location = await backend.put('test-key', stream);

      expect(location).toContain(ARCHIVES_DIR);
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenData = writeCall[1] as Buffer;
      expect(writtenData.toString()).toBe('chunk1chunk2chunk3');
    });

    it('handles stream with non-buffer chunks', async () => {
      const chunks = ['string1', 'string2'];
      const stream = Readable.from(chunks);
      mockFs.writeFileSync.mockImplementation(() => {});

      const location = await backend.put('test-key', stream);

      expect(location).toContain(ARCHIVES_DIR);
      expect(mockFs.writeFileSync).toHaveBeenCalled();

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const writtenData = writeCall[1] as Buffer;
      expect(writtenData.toString()).toBe('string1string2');
    });

    it('calls ensureArchivesDir before writing', async () => {
      const data = Buffer.from('test');
      mockIo.mkdirP.mockResolvedValue();
      mockFs.writeFileSync.mockImplementation(() => {});

      await backend.put('test-key', data);

      expect(mockIo.mkdirP).toHaveBeenCalledWith(archivesDir);
    });
  });

  describe('putFromPath', () => {
    it('returns relative path for existing archive', async () => {
      const existingPath = path.join(archivesDir, 'sha256-abc123.tar.zst');

      const location = await backend.putFromPath(existingPath);

      expect(location).toBe(path.join(ARCHIVES_DIR, 'sha256-abc123.tar.zst'));
    });

    it('extracts basename from full path', async () => {
      const existingPath = '/different/path/to/sha256-xyz789.tar.gz';

      const location = await backend.putFromPath(existingPath);

      expect(location).toBe(path.join(ARCHIVES_DIR, 'sha256-xyz789.tar.gz'));
    });
  });

  describe('get', () => {
    it('reads archive file', async () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');
      const testData = Buffer.from('archive data');

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(testData);

      const result = await backend.get(location);

      expect(result).toEqual(testData);
    });

    it('throws error when archive not found', async () => {
      const location = path.join(ARCHIVES_DIR, 'missing.tar.zst');

      mockFs.existsSync.mockReturnValue(false);

      await expect(backend.get(location)).rejects.toThrow('Archive not found');
    });
  });

  describe('getFullPath', () => {
    it('resolves relative location to full path', () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');

      const fullPath = backend.getFullPath(location);

      expect(fullPath).toBe(path.join(cacheDir, location));
    });

    it('handles different archive names', () => {
      const location = path.join(ARCHIVES_DIR, 'sha256-abc123.tar.gz');

      const fullPath = backend.getFullPath(location);

      expect(fullPath).toBe(path.join(cacheDir, location));
    });
  });

  describe('delete', () => {
    it('deletes existing archive', async () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');

      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockImplementation(() => {});

      await backend.delete(location);

      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('does nothing if archive does not exist', async () => {
      const location = path.join(ARCHIVES_DIR, 'missing.tar.zst');

      mockFs.existsSync.mockReturnValue(false);

      await backend.delete(location);

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('exists', () => {
    it('returns true when archive exists', async () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');

      mockFs.existsSync.mockReturnValue(true);

      const result = await backend.exists(location);

      expect(result).toBe(true);
    });

    it('returns false when archive does not exist', async () => {
      const location = path.join(ARCHIVES_DIR, 'missing.tar.zst');

      mockFs.existsSync.mockReturnValue(false);

      const result = await backend.exists(location);

      expect(result).toBe(false);
    });
  });

  describe('getSize', () => {
    it('returns archive size', async () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 12345 } as fs.Stats);

      const size = await backend.getSize(location);

      expect(size).toBe(12345);
    });

    it('throws error when archive not found', async () => {
      const location = path.join(ARCHIVES_DIR, 'missing.tar.zst');

      mockFs.existsSync.mockReturnValue(false);

      await expect(backend.getSize(location)).rejects.toThrow('Archive not found');
    });

    it('reads stats from correct file path', async () => {
      const location = path.join(ARCHIVES_DIR, 'test.tar.zst');
      const expectedFullPath = path.join(cacheDir, location);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 999 } as fs.Stats);

      await backend.getSize(location);

      expect(mockFs.statSync).toHaveBeenCalledWith(expectedFullPath);
    });
  });

  describe('getArchivesDir', () => {
    it('returns archives directory path', () => {
      const dir = backend.getArchivesDir();

      expect(dir).toBe(archivesDir);
    });
  });

  describe('ensureArchivesDir', () => {
    it('creates archives directory', async () => {
      mockIo.mkdirP.mockResolvedValue();

      const dir = await backend.ensureArchivesDir();

      expect(mockIo.mkdirP).toHaveBeenCalledWith(archivesDir);
      expect(dir).toBe(archivesDir);
    });

    it('throws helpful error on EACCES permission denied', async () => {
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockIo.mkdirP.mockRejectedValue(error);

      await expect(backend.ensureArchivesDir()).rejects.toThrow(/Permission denied creating cache directory/);
      await expect(backend.ensureArchivesDir()).rejects.toThrow(/Use the default cache path/);
      await expect(backend.ensureArchivesDir()).rejects.toThrow(/For Docker: mount a host volume/);
    });

    it('propagates other errors', async () => {
      const error = new Error('Unknown error');
      mockIo.mkdirP.mockRejectedValue(error);

      await expect(backend.ensureArchivesDir()).rejects.toThrow('Unknown error');
    });

    it('includes parent directory in error message', async () => {
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockIo.mkdirP.mockRejectedValue(error);

      const expectedParentDir = path.dirname(path.dirname(archivesDir));

      try {
        await backend.ensureArchivesDir();
        fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain(expectedParentDir);
      }
    });
  });
});
