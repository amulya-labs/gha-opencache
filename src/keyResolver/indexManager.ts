import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import { INDEX_FILE, INDEX_VERSION, ARCHIVES_DIR } from '../constants';

export interface CacheEntry {
  key: string;
  archivePath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface CacheIndex {
  version: string;
  entries: CacheEntry[];
}

export function createEmptyIndex(): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: [],
  };
}

export async function loadIndex(cacheDir: string): Promise<CacheIndex> {
  const indexPath = path.join(cacheDir, INDEX_FILE);

  if (!fs.existsSync(indexPath)) {
    return createEmptyIndex();
  }

  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(content) as CacheIndex;

    if (index.version !== INDEX_VERSION) {
      // Future: handle migrations
      return createEmptyIndex();
    }

    return index;
  } catch {
    return createEmptyIndex();
  }
}

export async function saveIndex(cacheDir: string, index: CacheIndex): Promise<void> {
  await io.mkdirP(cacheDir);
  const indexPath = path.join(cacheDir, INDEX_FILE);
  const content = JSON.stringify(index, null, 2);
  fs.writeFileSync(indexPath, content, 'utf-8');
}

export function addEntry(index: CacheIndex, entry: CacheEntry): CacheIndex {
  // Remove any existing entry with the same key
  const filteredEntries = index.entries.filter(e => e.key !== entry.key);

  return {
    ...index,
    entries: [...filteredEntries, entry],
  };
}

export function removeEntry(index: CacheIndex, key: string): CacheIndex {
  return {
    ...index,
    entries: index.entries.filter(e => e.key !== key),
  };
}

export function findEntry(index: CacheIndex, key: string): CacheEntry | undefined {
  return index.entries.find(e => e.key === key);
}

export function findEntriesByPrefix(index: CacheIndex, prefix: string): CacheEntry[] {
  return index.entries
    .filter(e => e.key.startsWith(prefix))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function ensureArchivesDir(cacheDir: string): Promise<string> {
  const archivesDir = path.join(cacheDir, ARCHIVES_DIR);
  await io.mkdirP(archivesDir);
  return archivesDir;
}
