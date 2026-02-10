import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import { INDEX_FILE, INDEX_VERSION, ARCHIVES_DIR } from '../constants';

export interface CacheEntry {
  key: string;
  archivePath: string;
  createdAt: string;
  sizeBytes: number;
  expiresAt?: string; // ISO timestamp, undefined = never expires
  accessedAt?: string; // Updated on restore for LRU tracking
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

/**
 * Check if a cache entry has expired
 */
export function isExpired(entry: CacheEntry, now?: Date): boolean {
  if (!entry.expiresAt) {
    return false;
  }
  const expirationDate = new Date(entry.expiresAt);
  const currentDate = now || new Date();
  return currentDate >= expirationDate;
}

/**
 * Filter out expired entries from an array
 */
export function filterValidEntries(entries: CacheEntry[], now?: Date): CacheEntry[] {
  return entries.filter(entry => !isExpired(entry, now));
}

/**
 * Get total size of all cache entries in bytes
 */
export function getTotalCacheSize(index: CacheIndex): number {
  return index.entries.reduce((total, entry) => total + entry.sizeBytes, 0);
}

/**
 * Get entries sorted by LRU (least recently used first)
 * Uses accessedAt if available, otherwise falls back to createdAt
 */
export function getEntriesByLRU(index: CacheIndex): CacheEntry[] {
  return [...index.entries].sort((a, b) => {
    const aTime = new Date(a.accessedAt || a.createdAt).getTime();
    const bTime = new Date(b.accessedAt || b.createdAt).getTime();
    return aTime - bTime; // oldest first
  });
}

/**
 * Update the accessedAt timestamp for an entry
 */
export function updateAccessTime(index: CacheIndex, key: string, now?: Date): CacheIndex {
  const timestamp = (now || new Date()).toISOString();
  return {
    ...index,
    entries: index.entries.map(entry =>
      entry.key === key ? { ...entry, accessedAt: timestamp } : entry
    ),
  };
}

/**
 * Migrate index from v1 to v2
 * - Sets version to '2'
 * - Adds default accessedAt based on createdAt for existing entries
 */
export function migrateIndex(index: CacheIndex): CacheIndex {
  return {
    version: INDEX_VERSION,
    entries: index.entries.map(entry => ({
      ...entry,
      // Set accessedAt to createdAt if not present (for LRU ordering)
      accessedAt: entry.accessedAt || entry.createdAt,
      // expiresAt remains undefined for migrated entries (no expiration)
    })),
  };
}
