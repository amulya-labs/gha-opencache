import * as os from 'os';
import * as path from 'path';
import { getDefaultCachePath } from '../../src/constants';

describe('getDefaultCachePath', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OPENCACHE_PATH;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.LOCALAPPDATA;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('OPENCACHE_PATH override', () => {
    it('returns OPENCACHE_PATH when set', () => {
      process.env.OPENCACHE_PATH = '/custom/cache/path';
      expect(getDefaultCachePath()).toBe('/custom/cache/path');
    });

    it('returns OPENCACHE_PATH even if empty string (falsy check)', () => {
      // Empty string is falsy, so it should NOT be used
      process.env.OPENCACHE_PATH = '';
      const result = getDefaultCachePath();
      // Should fall through to platform default, not return empty string
      expect(result).not.toBe('');
    });
  });

  describe('Linux paths', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses XDG_CACHE_HOME when set', () => {
      process.env.XDG_CACHE_HOME = '/home/user/.my-cache';
      expect(getDefaultCachePath()).toBe('/home/user/.my-cache/gha-opencache');
    });

    it('falls back to $HOME/.cache when XDG_CACHE_HOME not set', () => {
      const home = os.homedir();
      expect(getDefaultCachePath()).toBe(path.join(home, '.cache', 'gha-opencache'));
    });
  });

  describe('macOS paths', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses ~/Library/Caches/gha-opencache', () => {
      const home = os.homedir();
      expect(getDefaultCachePath()).toBe(path.join(home, 'Library', 'Caches', 'gha-opencache'));
    });
  });

  describe('Windows paths', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses LOCALAPPDATA when set', () => {
      process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';
      expect(getDefaultCachePath()).toBe(
        path.join('C:\\Users\\TestUser\\AppData\\Local', 'gha-opencache')
      );
    });

    it('falls back to AppData/Local in home when LOCALAPPDATA not set', () => {
      const home = os.homedir();
      expect(getDefaultCachePath()).toBe(path.join(home, 'AppData', 'Local', 'gha-opencache'));
    });
  });
});
