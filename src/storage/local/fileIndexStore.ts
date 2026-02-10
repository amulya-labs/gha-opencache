import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
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
    if (!fs.existsSync(this.indexPath)) {
      return createEmptyIndex();
    }

    try {
      const content = fs.readFileSync(this.indexPath, 'utf-8');
      const index = JSON.parse(content) as CacheIndex;

      // Handle version migration
      if (index.version === '1') {
        return migrateIndex(index);
      }

      if (index.version !== INDEX_VERSION) {
        // Unknown future version - return empty to be safe
        return createEmptyIndex();
      }

      return index;
    } catch {
      return createEmptyIndex();
    }
  }

  async save(index: CacheIndex): Promise<void> {
    await io.mkdirP(this.cacheDir);
    const content = JSON.stringify(index, null, 2);
    fs.writeFileSync(this.indexPath, content, 'utf-8');
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
