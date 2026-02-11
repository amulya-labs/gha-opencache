import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import { CacheIndex } from '../../keyResolver/indexManager';
import { INDEX_VERSION, ARCHIVES_DIR } from '../../constants';
import { readManifest, manifestToEntry } from './manifestStore';

/**
 * Check if index rebuild should be triggered
 * Rebuild when OPENCACHE_REBUILD_INDEX=1 is set
 */
export function shouldRebuildIndex(): boolean {
  const envVar = process.env.OPENCACHE_REBUILD_INDEX;
  return envVar === '1' || envVar === 'true';
}

/**
 * Clean up stale temporary files (>1 hour old)
 * Returns count of deleted files
 */
export async function cleanupTempFiles(archivesDir: string): Promise<number> {
  if (!fs.existsSync(archivesDir)) {
    return 0;
  }

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    const files = fs.readdirSync(archivesDir);

    for (const file of files) {
      // Only process .tmp files
      if (!file.includes('.tmp')) {
        continue;
      }

      const filePath = path.join(archivesDir, file);
      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > oneHour) {
          fs.unlinkSync(filePath);
          deletedCount++;
          core.debug(`Deleted stale temp file: ${file}`);
        }
      } catch (err) {
        core.debug(`Failed to process temp file ${file}: ${err}`);
      }
    }

    if (deletedCount > 0) {
      core.info(`Cleaned up ${deletedCount} stale temporary files`);
    }
  } catch (err) {
    core.warning(`Failed to clean up temp files in ${archivesDir}: ${err}`);
  }

  return deletedCount;
}

/**
 * Rebuild index from manifest files
 * Scans archives directory for .meta.json files and reconstructs index
 */
export async function rebuildIndexFromManifests(cacheDir: string): Promise<CacheIndex> {
  const archivesDir = path.join(cacheDir, ARCHIVES_DIR);

  // Clean up stale temp files first
  await cleanupTempFiles(archivesDir);

  if (!fs.existsSync(archivesDir)) {
    core.debug('Archives directory does not exist, returning empty index');
    return {
      version: INDEX_VERSION,
      entries: [],
    };
  }

  const entries = [];
  let manifestCount = 0;
  let orphanedArchives = 0;
  let missingArchives = 0;

  try {
    const files = fs.readdirSync(archivesDir);

    // Find all manifest files (not .tmp)
    const manifestFiles = files.filter(
      file => file.endsWith('.meta.json') && !file.includes('.tmp')
    );

    for (const manifestFile of manifestFiles) {
      manifestCount++;

      try {
        // Read manifest
        const archiveFilename = manifestFile.replace('.meta.json', '');
        const archivePath = path.join(archivesDir, findArchiveFile(archivesDir, archiveFilename));

        const manifest = await readManifest(archivePath);
        if (!manifest) {
          core.debug(`Skipping invalid manifest: ${manifestFile}`);
          continue;
        }

        // Validate corresponding archive exists
        if (!fs.existsSync(archivePath)) {
          core.warning(
            `Archive file missing for manifest ${manifestFile} (expected: ${path.basename(archivePath)})`
          );
          missingArchives++;
          continue;
        }

        // Convert manifest to entry
        const entry = manifestToEntry(manifest, cacheDir);
        entries.push(entry);
      } catch (err) {
        core.warning(`Failed to process manifest ${manifestFile}: ${err}`);
      }
    }

    // Check for orphaned archives (archives without manifests)
    const archiveFiles = files.filter(
      file =>
        (file.endsWith('.tar') ||
          file.endsWith('.tar.zst') ||
          file.endsWith('.tar.gz') ||
          file.endsWith('.tar.bz2')) &&
        !file.includes('.tmp')
    );

    for (const archiveFile of archiveFiles) {
      const archivePath = path.join(archivesDir, archiveFile);
      const manifest = await readManifest(archivePath);
      if (!manifest) {
        orphanedArchives++;
        core.debug(`Orphaned archive without manifest: ${archiveFile}`);
      }
    }

    if (orphanedArchives > 0) {
      core.warning(
        `Found ${orphanedArchives} orphaned archives without manifests. ` +
          `These are likely from pre-v2 caches and will gain manifests on next restore+resave cycle.`
      );
    }

    core.info(
      `Rebuilt index from ${manifestCount} manifests: ${entries.length} valid entries, ` +
        `${missingArchives} missing archives, ${orphanedArchives} orphaned archives`
    );
  } catch (err) {
    core.error(`Failed to rebuild index from manifests: ${err}`);
    // Return empty index on failure (degraded mode)
    return {
      version: INDEX_VERSION,
      entries: [],
    };
  }

  return {
    version: INDEX_VERSION,
    entries,
  };
}

/**
 * Find archive file with given base name (handles different extensions)
 * Returns the filename with extension
 */
function findArchiveFile(archivesDir: string, baseName: string): string {
  const extensions = ['.tar.zst', '.tar.gz', '.tar.bz2', '.tar'];

  for (const ext of extensions) {
    const filename = baseName + ext;
    const filePath = path.join(archivesDir, filename);
    if (fs.existsSync(filePath)) {
      return filename;
    }
  }

  // Default to .tar.zst if not found
  return baseName + '.tar.zst';
}
