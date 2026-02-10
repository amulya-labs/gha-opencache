import { CacheEntry, CacheIndex, findEntry, findEntriesByPrefix } from './indexManager';

export interface ResolveResult {
  entry: CacheEntry | undefined;
  isExactMatch: boolean;
  matchedKey: string | undefined;
}

/**
 * Resolves a cache key against the index.
 *
 * Algorithm:
 * 1. Try exact match on primary key -> cache-hit: true
 * 2. Try prefix match on restore-keys in order, newest matching entry wins -> cache-hit: false
 * 3. No match found -> cache-hit: false, no entry
 */
export function resolveKey(
  index: CacheIndex,
  primaryKey: string,
  restoreKeys: string[]
): ResolveResult {
  // Step 1: Exact match on primary key
  const exactMatch = findEntry(index, primaryKey);
  if (exactMatch) {
    return {
      entry: exactMatch,
      isExactMatch: true,
      matchedKey: primaryKey,
    };
  }

  // Step 2: Try restore-keys in order (first match wins, but newest within that prefix)
  for (const restoreKey of restoreKeys) {
    const matches = findEntriesByPrefix(index, restoreKey);
    if (matches.length > 0) {
      // matches are already sorted by createdAt descending, so first is newest
      const newestMatch = matches[0];
      return {
        entry: newestMatch,
        isExactMatch: false,
        matchedKey: newestMatch.key,
      };
    }
  }

  // Step 3: No match
  return {
    entry: undefined,
    isExactMatch: false,
    matchedKey: undefined,
  };
}
