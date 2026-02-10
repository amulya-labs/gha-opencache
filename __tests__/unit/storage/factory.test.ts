import {
  createStorageProvider,
  isValidStorageType,
  getDefaultStorageType,
} from '../../../src/storage/factory';
import { LocalStorageProvider } from '../../../src/storage/local/localProvider';
import { S3StorageProvider } from '../../../src/storage/s3/s3Provider';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('storage factory', () => {
  describe('isValidStorageType', () => {
    it('returns true for local', () => {
      expect(isValidStorageType('local')).toBe(true);
    });

    it('returns true for s3', () => {
      expect(isValidStorageType('s3')).toBe(true);
    });

    it('returns true for custom', () => {
      expect(isValidStorageType('custom')).toBe(true);
    });

    it('returns false for invalid types', () => {
      expect(isValidStorageType('azure')).toBe(false);
      expect(isValidStorageType('gcs')).toBe(false);
      expect(isValidStorageType('')).toBe(false);
    });
  });

  describe('getDefaultStorageType', () => {
    it('returns local', () => {
      expect(getDefaultStorageType()).toBe('local');
    });
  });

  describe('createStorageProvider', () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
    });

    afterAll(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates LocalStorageProvider for local type', async () => {
      const provider = await createStorageProvider({
        type: 'local',
        owner: 'test-owner',
        repo: 'test-repo',
        options: { basePath: tempDir },
      });

      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('creates S3StorageProvider for s3 type', async () => {
      const provider = await createStorageProvider({
        type: 's3',
        owner: 'test-owner',
        repo: 'test-repo',
        options: {
          bucket: 'test-bucket',
          region: 'us-east-1',
        },
      });

      expect(provider).toBeInstanceOf(S3StorageProvider);
    });

    it('passes ttlDays and maxCacheSizeGb to provider', async () => {
      const provider = await createStorageProvider({
        type: 'local',
        owner: 'test-owner',
        repo: 'test-repo',
        options: { basePath: tempDir },
        ttlDays: 7,
        maxCacheSizeGb: 5,
      });

      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('creates custom provider from factory function', async () => {
      const mockProvider = {
        resolve: jest.fn(),
        restore: jest.fn(),
        save: jest.fn(),
        exists: jest.fn(),
        getIndex: jest.fn(),
      };

      const provider = await createStorageProvider({
        type: 'custom',
        owner: 'test-owner',
        repo: 'test-repo',
        options: {
          createProvider: async () => mockProvider,
        },
      });

      expect(provider).toBe(mockProvider);
    });

    it('throws for custom type without createProvider', async () => {
      await expect(
        createStorageProvider({
          type: 'custom',
          owner: 'test-owner',
          repo: 'test-repo',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          options: {} as any,
        })
      ).rejects.toThrow('Custom storage provider requires a createProvider function');
    });

    it('throws for unknown type', async () => {
      await expect(
        createStorageProvider({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: 'unknown' as any,
          owner: 'test-owner',
          repo: 'test-repo',
          options: { basePath: tempDir },
        })
      ).rejects.toThrow('Unknown storage provider type: unknown');
    });
  });
});
