import {
  CacheEntry,
  CacheIndex,
  findEntry,
  findEntriesByPrefix,
  isExpired,
  filterValidEntries,
} from './indexManager';

export interface ResolveResult {
  entry: CacheEntry | undefined;
  isExactMatch: boolean;
  matchedKey: string | undefined;
}

/**
 * Resolves a cache key against the index.
 *
 * Algorithm:
 * 1. Try exact match on primary key (if not expired) -> cache-hit: true
 * 2. Try prefix match on restore-keys in order, newest non-expired matching entry wins -> cache-hit: false
 * 3. No match found -> cache-hit: false, no entry
 */
export function resolveKey(
  index: CacheIndex,
  primaryKey: string,
  restoreKeys: string[]
): ResolveResult {
  const now = new Date();

  // Step 1: Exact match on primary key (if not expired)
  const exactMatch = findEntry(index, primaryKey);
  if (exactMatch && !isExpired(exactMatch, now)) {
    return {
      entry: exactMatch,
      isExactMatch: true,
      matchedKey: primaryKey,
    };
  }

  // Step 2: Try restore-keys in order (first match wins, but newest non-expired within that prefix)
  for (const restoreKey of restoreKeys) {
    const matches = findEntriesByPrefix(index, restoreKey);
    const validMatches = filterValidEntries(matches, now);
    if (validMatches.length > 0) {
      // matches are already sorted by createdAt descending, so first is newest
      const newestMatch = validMatches[0];
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
