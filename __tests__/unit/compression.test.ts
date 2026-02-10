import {
  getArchiveExtension,
  getCompressionMethodFromPath,
  resolveCompressionMethod,
} from '../../src/archive/compression';
import * as io from '@actions/io';
import * as core from '@actions/core';

jest.mock('@actions/io');
jest.mock('@actions/core');

describe('compression', () => {
  const mockIo = io as jest.Mocked<typeof io>;
  const mockCore = core as jest.Mocked<typeof core>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArchiveExtension', () => {
    it('returns .tar.zst for zstd', () => {
      expect(getArchiveExtension('zstd')).toBe('.tar.zst');
    });

    it('returns .tar.gz for gzip', () => {
      expect(getArchiveExtension('gzip')).toBe('.tar.gz');
    });

    it('returns .tar for none', () => {
      expect(getArchiveExtension('none')).toBe('.tar');
    });
  });

  describe('getCompressionMethodFromPath', () => {
    it('detects zstd from .tar.zst extension', () => {
      expect(getCompressionMethodFromPath('/path/to/file.tar.zst')).toBe('zstd');
    });

    it('detects zstd from .zst extension', () => {
      expect(getCompressionMethodFromPath('/path/to/file.zst')).toBe('zstd');
    });

    it('detects gzip from .tar.gz extension', () => {
      expect(getCompressionMethodFromPath('/path/to/file.tar.gz')).toBe('gzip');
    });

    it('detects gzip from .gz extension', () => {
      expect(getCompressionMethodFromPath('/path/to/file.gz')).toBe('gzip');
    });

    it('returns none for .tar extension', () => {
      expect(getCompressionMethodFromPath('/path/to/file.tar')).toBe('none');
    });

    it('returns none for unknown extensions', () => {
      expect(getCompressionMethodFromPath('/path/to/file.unknown')).toBe('none');
    });
  });

  describe('resolveCompressionMethod', () => {
    describe('with auto method', () => {
      it('returns zstd when zstd is available', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/zstd');

        const result = await resolveCompressionMethod({ method: 'auto' });

        expect(result.method).toBe('zstd');
        expect(result.level).toBe(3); // default zstd level
      });

      it('falls back to gzip when zstd is not available', async () => {
        mockIo.which.mockRejectedValue(new Error('not found'));

        const result = await resolveCompressionMethod({ method: 'auto' });

        expect(result.method).toBe('gzip');
        expect(result.level).toBe(6); // default gzip level
      });
    });

    describe('with explicit zstd', () => {
      it('uses zstd with default level when available', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/zstd');

        const result = await resolveCompressionMethod({ method: 'zstd' });

        expect(result.method).toBe('zstd');
        expect(result.level).toBe(3);
      });

      it('uses specified compression level', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/zstd');

        const result = await resolveCompressionMethod({ method: 'zstd', level: 10 });

        expect(result.method).toBe('zstd');
        expect(result.level).toBe(10);
      });

      it('clamps invalid zstd level to valid range', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/zstd');

        const result = await resolveCompressionMethod({ method: 'zstd', level: 25 });

        expect(result.level).toBe(19);
        expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('clamping'));
      });

      it('throws when zstd is not available', async () => {
        mockIo.which.mockRejectedValue(new Error('not found'));

        await expect(resolveCompressionMethod({ method: 'zstd' })).rejects.toThrow(
          "Compression method 'zstd' is not available"
        );
      });
    });

    describe('with explicit gzip', () => {
      it('uses gzip with default level when available', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/gzip');

        const result = await resolveCompressionMethod({ method: 'gzip' });

        expect(result.method).toBe('gzip');
        expect(result.level).toBe(6);
      });

      it('uses specified compression level', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/gzip');

        const result = await resolveCompressionMethod({ method: 'gzip', level: 9 });

        expect(result.method).toBe('gzip');
        expect(result.level).toBe(9);
      });

      it('clamps invalid gzip level to valid range', async () => {
        mockIo.which.mockResolvedValue('/usr/bin/gzip');

        const result = await resolveCompressionMethod({ method: 'gzip', level: 15 });

        expect(result.level).toBe(9);
        expect(mockCore.warning).toHaveBeenCalledWith(expect.stringContaining('clamping'));
      });
    });

    describe('with none method', () => {
      it('returns none with level 0', async () => {
        const result = await resolveCompressionMethod({ method: 'none' });

        expect(result.method).toBe('none');
        expect(result.level).toBe(0);
      });

      it('ignores specified level for none', async () => {
        const result = await resolveCompressionMethod({ method: 'none', level: 5 });

        expect(result.level).toBe(0);
      });
    });
  });
});
