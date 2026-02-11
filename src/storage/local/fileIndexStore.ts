import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import * as core from '@actions/core';
import { IndexStore } from '../interfaces';
import { CacheIndex } from '../../keyResolver/indexManager';
import { INDEX_FILE, INDEX_VERSION } from '../../constants';

/**
 * File-based index store using JSON files
 * Stores cache index as a JSON file on the local filesystem
 */
export class FileIndexStore implements IndexStore {
  private readonly indexPath: string;
  private readonly cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    this.indexPath = path.join(cacheDir, INDEX_FILE);
  }

  async load(): Promise<CacheIndex> {
    // File doesn't exist - expected, return empty index
    if (!fs.existsSync(this.indexPath)) {
      core.debug(`Index file not found at ${this.indexPath}, returning empty index`);
      return createEmptyIndex();
    }

    try {
      const content = fs.readFileSync(this.indexPath, 'utf-8');
      const index = JSON.parse(content) as CacheIndex;

      // Handle version migration
      if (index.version === '1') {
        core.debug('Migrating index from version 1 to version 2');
        return migrateIndex(index);
      }

      if (index.version !== INDEX_VERSION) {
        // Unknown future version - return empty to be safe
        core.warning(
          `Index version ${index.version} is not recognized (expected ${INDEX_VERSION}). ` +
            `Returning empty index. Cache entries will be rebuilt.`
        );
        return createEmptyIndex();
      }

      return index;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      // Handle specific error types
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        // Permission denied - this is a fatal error that should be surfaced
        throw new Error(
          `Permission denied reading cache index at ${this.indexPath}. ` +
            `Please check file permissions: ${error.message}`
        );
      }

      if (error.code === 'ENOSPC') {
        // Disk full - fatal error
        throw new Error(
          `Disk full while reading cache index at ${this.indexPath}: ${error.message}`
        );
      }

      if (error.code === 'EIO') {
        // I/O error - fatal error
        throw new Error(`I/O error reading cache index at ${this.indexPath}: ${error.message}`);
      }

      // JSON parse error or other recoverable error - log warning and return empty
      if (error instanceof SyntaxError || error.name === 'SyntaxError') {
        core.warning(
          `Cache index at ${this.indexPath} is corrupted (invalid JSON). ` +
            `Returning empty index. Cache entries will be rebuilt. Error: ${error.message}`
        );
        core.debug(
          `Corrupted index content preview: ${fs.readFileSync(this.indexPath, 'utf-8').substring(0, 200)}`
        );
        return createEmptyIndex();
      }

      // Unknown error - log and propagate
      core.warning(`Unexpected error loading cache index from ${this.indexPath}: ${error}`);
      throw new Error(
        `Failed to load cache index from ${this.indexPath}: ${error.message || error}`
      );
    }
  }

  async save(index: CacheIndex): Promise<void> {
    let tempPath: string | undefined;
    try {
      await io.mkdirP(this.cacheDir);
      const content = JSON.stringify(index, null, 2);

      // Atomic write: write to temp file, then rename
      // This prevents corruption if process crashes during write
      tempPath = `${this.indexPath}.tmp.${Date.now()}.${process.pid}`;
      fs.writeFileSync(tempPath, content, 'utf-8');

      // Atomic rename (POSIX guarantees atomicity of rename)
      fs.renameSync(tempPath, this.indexPath);
      tempPath = undefined; // Successfully renamed, no cleanup needed

      core.debug(
        `Successfully saved cache index to ${this.indexPath} with ${index.entries.length} entries`
      );
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      // Clean up temp file if it exists
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Classify error types for better diagnostics
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(
          `Permission denied writing cache index to ${this.indexPath}. ` +
            `Please check directory permissions: ${error.message}`
        );
      }

      if (error.code === 'ENOSPC') {
        throw new Error(
          `Disk full while writing cache index to ${this.indexPath}: ${error.message}`
        );
      }

      if (error.code === 'EIO') {
        throw new Error(`I/O error writing cache index to ${this.indexPath}: ${error.message}`);
      }

      if (error.code === 'EROFS') {
        throw new Error(
          `Read-only filesystem, cannot write cache index to ${this.indexPath}: ${error.message}`
        );
      }

      // Unknown error
      throw new Error(`Failed to save cache index to ${this.indexPath}: ${error.message || error}`);
    }
  }
}

/**
 * Create an empty cache index
 */
function createEmptyIndex(): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: [],
  };
}

/**
 * Migrate index from v1 to v2
 * - Sets version to '2'
 * - Adds default accessedAt based on createdAt for existing entries
 */
function migrateIndex(index: CacheIndex): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: index.entries.map(entry => ({
      ...entry,
      // Set accessedAt to createdAt if not present (for LRU ordering)
      accessedAt: entry.accessedAt || entry.createdAt,
    })),
  };
}

/**
 * Create a FileIndexStore for a cache directory
 * @param cacheDir - Cache directory path
 */
export function createFileIndexStore(cacheDir: string): IndexStore {
  return new FileIndexStore(cacheDir);
}
