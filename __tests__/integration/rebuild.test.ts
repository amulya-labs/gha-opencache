import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageProvider } from '../../src/storage/local/localProvider';
import {
  rebuildIndexFromManifests,
  cleanupTempFiles,
} from '../../src/storage/local/indexRebuilder';
import {
  writeManifest,
  readManifest,
  entryToManifest,
} from '../../src/storage/local/manifestStore';
import { CacheEntry } from '../../src/keyResolver/indexManager';
import { ARCHIVES_DIR, INDEX_FILE } from '../../src/constants';

describe('Index Rebuild Integration', () => {
  let testDir: string;
  let cacheDir: string;
  let archivesDir: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    // Create unique test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencache-rebuild-test-'));
    cacheDir = path.join(testDir, 'owner', 'repo');
    archivesDir = path.join(cacheDir, ARCHIVES_DIR);

    // Ensure directories exist
    fs.mkdirSync(archivesDir, { recursive: true });

    // Create provider
    provider = new LocalStorageProvider(testDir, 'owner', 'repo');
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Corruption Recovery', () => {
    test('corrupted index.json triggers rebuild from manifests', async () => {
      // Create a valid cache entry with manifest
      const entry = createMockEntry('test-key-1');
      const archivePath = createMockArchive(archivesDir, 'sha256-abc123.tar.zst');
      await writeManifest(archivePath, entryToManifest(entry, 'zstd'));

      // Create corrupted index
      const indexPath = path.join(cacheDir, INDEX_FILE);
      fs.writeFileSync(indexPath, 'corrupted json {{{', 'utf-8');

      // Load index should trigger rebuild
      const index = await provider.getIndex();

      // Verify rebuild succeeded
      expect(index.entries.length).toBe(1);
      expect(index.entries[0].key).toBe('test-key-1');
    });

    test('missing index.json with manifests triggers rebuild', async () => {
      // Create cache entries with manifests but no index
      const entry1 = createMockEntry('test-key-1');
      const entry2 = createMockEntry('test-key-2');

      const archive1 = createMockArchive(archivesDir, 'sha256-abc123.tar.zst');
      const archive2 = createMockArchive(archivesDir, 'sha256-def456.tar.zst');

      await writeManifest(archive1, entryToManifest(entry1, 'zstd'));
      await writeManifest(archive2, entryToManifest(entry2, 'zstd'));

      // No index file exists
      const indexPath = path.join(cacheDir, INDEX_FILE);
      expect(fs.existsSync(indexPath)).toBe(false);

      // Load index should trigger rebuild
      const index = await provider.getIndex();

      // Verify rebuild succeeded
      expect(index.entries.length).toBe(2);
      expect(index.entries.map(e => e.key).sort()).toEqual(['test-key-1', 'test-key-2']);
    });

    test('missing index.json without manifests returns empty', async () => {
      // No manifests, no index
      const indexPath = path.join(cacheDir, INDEX_FILE);
      expect(fs.existsSync(indexPath)).toBe(false);

      // Load index should return empty
      const index = await provider.getIndex();

      // Verify empty index
      expect(index.entries.length).toBe(0);
    });

    test('partial manifests handled gracefully', async () => {
      // Create valid entry
      const entry1 = createMockEntry('test-key-1');
      const archive1 = createMockArchive(archivesDir, 'sha256-abc123.tar.zst');
      await writeManifest(archive1, entryToManifest(entry1, 'zstd'));

      // Create manifest without corresponding archive
      const entry2 = createMockEntry('test-key-2');
      const archive2Path = path.join(archivesDir, 'sha256-missing.tar.zst');
      await writeManifest(archive2Path, entryToManifest(entry2, 'zstd'));
      // Don't create archive2

      // Rebuild should skip missing archive
      const index = await rebuildIndexFromManifests(cacheDir);

      expect(index.entries.length).toBe(1);
      expect(index.entries[0].key).toBe('test-key-1');
    });
  });

  describe('Manual Rebuild', () => {
    test('OPENCACHE_REBUILD_INDEX=1 triggers rebuild', async () => {
      // Create cache with manifest
      const entry = createMockEntry('test-key-1');
      const archive = createMockArchive(archivesDir, 'sha256-abc123.tar.zst');
      await writeManifest(archive, entryToManifest(entry, 'zstd'));

      // Create index with different data
      const indexPath = path.join(cacheDir, INDEX_FILE);
      fs.writeFileSync(
        indexPath,
        JSON.stringify({
          version: '2',
          entries: [createMockEntry('old-key')],
        }),
        'utf-8'
      );

      // Set env var to trigger rebuild
      const originalValue = process.env.OPENCACHE_REBUILD_INDEX;
      process.env.OPENCACHE_REBUILD_INDEX = '1';

      try {
        const index = await provider.getIndex();

        // Should have rebuilt from manifests
        expect(index.entries.length).toBe(1);
        expect(index.entries[0].key).toBe('test-key-1');
      } finally {
        // Restore env var
        if (originalValue !== undefined) {
          process.env.OPENCACHE_REBUILD_INDEX = originalValue;
        } else {
          delete process.env.OPENCACHE_REBUILD_INDEX;
        }
      }
    });
  });

  describe('Temp File Handling', () => {
    test('.tmp files ignored during rebuild', async () => {
      // Create valid entry
      const entry = createMockEntry('test-key-1');
      const archive = createMockArchive(archivesDir, 'sha256-abc123.tar.zst');
      await writeManifest(archive, entryToManifest(entry, 'zstd'));

      // Create .tmp files that should be ignored
      createMockArchive(archivesDir, 'sha256-temp1.tar.zst.tmp');
      const tempManifestPath = path.join(archivesDir, 'sha256-temp2.meta.json.tmp');
      fs.writeFileSync(tempManifestPath, JSON.stringify(entryToManifest(entry, 'zstd')), 'utf-8');

      // Rebuild should ignore .tmp files
      const index = await rebuildIndexFromManifests(cacheDir);

      expect(index.entries.length).toBe(1);
      expect(index.entries[0].key).toBe('test-key-1');
    });

    test('stale .tmp files cleaned up', async () => {
      // Create old .tmp file (>1 hour old)
      const oldTempPath = path.join(archivesDir, 'sha256-old.tar.zst.tmp');
      fs.writeFileSync(oldTempPath, 'temp data', 'utf-8');

      // Set mtime to 2 hours ago
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      fs.utimesSync(oldTempPath, new Date(twoHoursAgo), new Date(twoHoursAgo));

      // Create recent .tmp file (<1 hour old)
      const recentTempPath = path.join(archivesDir, 'sha256-recent.tar.zst.tmp');
      fs.writeFileSync(recentTempPath, 'temp data', 'utf-8');

      // Clean up temp files
      const deletedCount = await cleanupTempFiles(archivesDir);

      // Old file should be deleted
      expect(fs.existsSync(oldTempPath)).toBe(false);
      // Recent file should remain
      expect(fs.existsSync(recentTempPath)).toBe(true);
      // Should have deleted 1 file
      expect(deletedCount).toBe(1);
    });
  });

  describe('Manifest Operations', () => {
    test('write and read manifest round-trip', async () => {
      const entry = createMockEntry('test-key');
      const archivePath = path.join(archivesDir, 'sha256-test.tar.zst');

      // Write manifest
      await writeManifest(archivePath, entryToManifest(entry, 'zstd'));

      // Read manifest
      const manifest = await readManifest(archivePath);

      // Verify round-trip
      expect(manifest).toBeDefined();
      expect(manifest!.key).toBe('test-key');
      expect(manifest!.compressionMethod).toBe('zstd');
    });

    test('manifest path derived correctly', async () => {
      const { getManifestPath } = await import('../../src/storage/local/manifestStore');

      expect(getManifestPath('/path/sha256-abc.tar.zst')).toBe('/path/sha256-abc.meta.json');
      expect(getManifestPath('/path/sha256-abc.tar.gz')).toBe('/path/sha256-abc.meta.json');
      expect(getManifestPath('/path/sha256-abc.tar')).toBe('/path/sha256-abc.meta.json');
    });
  });

  describe('Orphaned Archives', () => {
    test('archives without manifests logged as orphaned', async () => {
      // Create archive without manifest (pre-v2 cache)
      createMockArchive(archivesDir, 'sha256-orphan.tar.zst');

      // Rebuild should log warning about orphaned archive
      const index = await rebuildIndexFromManifests(cacheDir);

      // Should return empty (no manifests to rebuild from)
      expect(index.entries.length).toBe(0);
    });
  });
});

/**
 * Helper: Create mock cache entry
 */
function createMockEntry(key: string): CacheEntry {
  const now = new Date().toISOString();
  return {
    key,
    archivePath: path.join(ARCHIVES_DIR, `sha256-${key}.tar.zst`),
    createdAt: now,
    sizeBytes: 1024,
    accessedAt: now,
  };
}

/**
 * Helper: Create mock archive file
 */
function createMockArchive(archivesDir: string, filename: string): string {
  const archivePath = path.join(archivesDir, filename);
  fs.writeFileSync(archivePath, 'mock archive data', 'utf-8');
  return archivePath;
}
