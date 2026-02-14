import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { CacheEntry } from '../../keyResolver/indexManager';
import { MANIFEST_VERSION, ARCHIVES_DIR } from '../../constants';
import { CompressionMethod } from '../../archive/compression';

/**
 * Manifest file schema stored alongside each archive
 * This is the source of truth for cache metadata
 */
export interface ArchiveManifest {
  /** Schema version for future migrations */
  version: string;
  /** Cache key */
  key: string;
  /** Creation timestamp */
  createdAt: string;
  /** Archive file size in bytes */
  sizeBytes: number;
  /** Archive filename (without directory) */
  archiveFilename: string;
  /** Compression method used */
  compressionMethod: CompressionMethod;
  /** Expiration timestamp (optional) */
  expiresAt?: string;
  /** Last access timestamp for LRU */
  accessedAt: string;
}

/**
 * Convert cache entry to manifest format
 */
export function entryToManifest(
  entry: CacheEntry,
  compressionMethod: CompressionMethod
): ArchiveManifest {
  return {
    version: MANIFEST_VERSION,
    key: entry.key,
    createdAt: entry.createdAt,
    sizeBytes: entry.sizeBytes,
    archiveFilename: path.basename(entry.archivePath),
    compressionMethod,
    expiresAt: entry.expiresAt,
    accessedAt: entry.accessedAt || entry.createdAt,
  };
}

/**
 * Convert manifest to cache entry format
 */
export function manifestToEntry(manifest: ArchiveManifest, _cacheDir: string): CacheEntry {
  return {
    key: manifest.key,
    archivePath: path.join(ARCHIVES_DIR, manifest.archiveFilename),
    createdAt: manifest.createdAt,
    sizeBytes: manifest.sizeBytes,
    expiresAt: manifest.expiresAt,
    accessedAt: manifest.accessedAt,
  };
}

/**
 * Get manifest file path from archive file path
 * Example: sha256-abc123.tar.zst -> sha256-abc123.meta.json
 */
export function getManifestPath(archivePath: string): string {
  const dir = path.dirname(archivePath);
  const basename = path.basename(archivePath);
  // Remove all extensions (e.g., .tar.zst, .tar.gz, .tar)
  const nameWithoutExt = basename.replace(/\.(tar\.(zst|gz|bz2)|tar)$/, '');
  return path.join(dir, `${nameWithoutExt}.meta.json`);
}

/**
 * Write manifest file atomically
 * Uses temp file + rename to prevent corruption
 */
export async function writeManifest(archivePath: string, manifest: ArchiveManifest): Promise<void> {
  const manifestPath = getManifestPath(archivePath);
  const tempPath = `${manifestPath}.tmp.${Date.now()}.${process.pid}`;

  try {
    const content = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, manifestPath);
    core.debug(`Wrote manifest: ${manifestPath}`);
  } catch (err) {
    // Clean up temp file on error
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw new Error(`Failed to write manifest ${manifestPath}: ${err}`);
  }
}

/**
 * Read manifest file
 * Returns undefined if file doesn't exist or is invalid
 */
export async function readManifest(archivePath: string): Promise<ArchiveManifest | undefined> {
  const manifestPath = getManifestPath(archivePath);

  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ArchiveManifest;

    // Basic validation
    if (!manifest.version || !manifest.key || !manifest.archiveFilename) {
      const missing: string[] = [];
      if (!manifest.version) missing.push('version');
      if (!manifest.key) missing.push('key');
      if (!manifest.archiveFilename) missing.push('archiveFilename');

      core.warning(
        `Invalid manifest format: ${manifestPath}\n` +
          `Missing fields: ${missing.join(', ')}\n` +
          `Cache entry will be ignored. To fix: rm ${manifestPath}`
      );
      return undefined;
    }

    // Version validation
    if (manifest.version !== MANIFEST_VERSION) {
      core.warning(
        `Incompatible manifest version: ${manifest.version} (expected: ${MANIFEST_VERSION}): ${manifestPath}\n` +
          `Cache entry will be ignored. Re-save cache to update to current version.`
      );
      return undefined;
    }

    return manifest;
  } catch (err) {
    core.warning(
      `Failed to read manifest ${manifestPath}: ${err}\n` +
        `Cache entry will not be available. Consider removing corrupted file: rm ${manifestPath}`
    );
    return undefined;
  }
}

/**
 * Delete manifest file
 * Best-effort operation - doesn't throw on failure
 */
export async function deleteManifest(archivePath: string): Promise<void> {
  const manifestPath = getManifestPath(archivePath);

  try {
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      core.debug(`Deleted manifest: ${manifestPath}`);
    }
  } catch (err) {
    core.debug(`Failed to delete manifest ${manifestPath}: ${err}`);
  }
}
