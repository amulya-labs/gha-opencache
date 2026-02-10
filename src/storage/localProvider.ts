import * as path from 'path';
import * as fs from 'fs';
import * as core from '@actions/core';
import { StorageProvider } from './types';
import { withLock } from './locking';
import {
  CacheEntry,
  CacheIndex,
  loadIndex,
  saveIndex,
  addEntry,
  findEntry,
  ensureArchivesDir,
} from '../keyResolver/indexManager';
import { resolveKey, ResolveResult } from '../keyResolver/resolver';
import { createArchive, extractArchive } from '../archive/tar';
import { INDEX_FILE } from '../constants';

export class LocalStorageProvider implements StorageProvider {
  private readonly cacheDir: string;
  private readonly lockPath: string;

  constructor(basePath: string, owner: string, repo: string) {
    this.cacheDir = path.join(basePath, owner, repo);
    this.lockPath = path.join(this.cacheDir, `${INDEX_FILE}.lock`);
  }

  async resolve(primaryKey: string, restoreKeys: string[]): Promise<ResolveResult> {
    return withLock(this.lockPath, async () => {
      const index = await loadIndex(this.cacheDir);
      return resolveKey(index, primaryKey, restoreKeys);
    });
  }

  async restore(entry: CacheEntry): Promise<void> {
    const archivePath = path.join(this.cacheDir, entry.archivePath);

    if (!fs.existsSync(archivePath)) {
      throw new Error(`Cache archive not found: ${archivePath}`);
    }

    core.info(`Extracting cache from ${archivePath}`);
    await extractArchive(archivePath, process.cwd());
    core.info(`Cache restored successfully`);
  }

  async save(key: string, paths: string[]): Promise<CacheEntry> {
    return withLock(this.lockPath, async () => {
      const index = await loadIndex(this.cacheDir);

      // Check if entry already exists
      const existing = findEntry(index, key);
      if (existing) {
        core.info(`Cache entry already exists for key: ${key}`);
        return existing;
      }

      // Create archive
      const archivesDir = await ensureArchivesDir(this.cacheDir);
      core.info(`Creating cache archive for ${paths.length} path(s)`);

      const result = await createArchive(paths, archivesDir);

      const entry: CacheEntry = {
        key,
        archivePath: path.relative(this.cacheDir, result.archivePath),
        createdAt: new Date().toISOString(),
        sizeBytes: result.sizeBytes,
      };

      // Update index
      const updatedIndex = addEntry(index, entry);
      await saveIndex(this.cacheDir, updatedIndex);

      core.info(`Cache saved: ${key} (${formatBytes(entry.sizeBytes)})`);

      return entry;
    });
  }

  async exists(key: string): Promise<boolean> {
    return withLock(this.lockPath, async () => {
      const index = await loadIndex(this.cacheDir);
      return findEntry(index, key) !== undefined;
    });
  }

  async getIndex(): Promise<CacheIndex> {
    return withLock(this.lockPath, async () => {
      return loadIndex(this.cacheDir);
    });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function createLocalStorageProvider(
  basePath: string,
  owner: string,
  repo: string
): StorageProvider {
  return new LocalStorageProvider(basePath, owner, repo);
}
