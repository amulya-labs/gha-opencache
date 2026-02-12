import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as io from '@actions/io';
import { Readable } from 'stream';
import { StorageBackend } from '../interfaces';
import { ARCHIVES_DIR } from '../../constants';

/**
 * Local filesystem storage backend
 * Stores cache archives as files on the local filesystem
 */
export class LocalStorageBackend implements StorageBackend {
  private readonly archivesDir: string;

  constructor(cacheDir: string) {
    this.archivesDir = path.join(cacheDir, ARCHIVES_DIR);
  }

  /**
   * Store archive data to filesystem
   * @param key - Not used for local storage (archive is already named)
   * @param data - Archive data (expects a file path in this case)
   * @returns Relative path to the archive
   */
  async put(key: string, data: Buffer | Readable): Promise<string> {
    await this.ensureArchivesDir();

    // For local storage, we expect the archive to already be created
    // by the tar module with its hash-based naming
    // This method is used for consistency with the interface
    // The actual implementation handles the file path directly

    if (Buffer.isBuffer(data)) {
      // Generate a unique filename
      const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
      const filename = `sha256-${hash}.tar.zst`;
      const archivePath = path.join(this.archivesDir, filename);
      fs.writeFileSync(archivePath, data);
      return path.join(ARCHIVES_DIR, filename);
    }

    // For streams, we need to collect the data first
    const chunks: Buffer[] = [];
    for await (const chunk of data) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    return this.put(key, buffer);
  }

  /**
   * Put an archive file that already exists at a given path
   * This is the main method used by the local provider
   * @param existingPath - Full path to the existing archive file
   * @returns Relative path to the archive
   */
  async putFromPath(existingPath: string): Promise<string> {
    // The archive is already in the right place (archivesDir)
    // Just return the relative path
    const filename = path.basename(existingPath);
    return path.join(ARCHIVES_DIR, filename);
  }

  async get(location: string): Promise<Buffer> {
    const fullPath = this.resolveLocation(location);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archive not found: ${location}`);
    }
    return fs.readFileSync(fullPath);
  }

  /**
   * Get the full path to an archive for extraction
   * This is specific to local storage where we can access files directly
   */
  getFullPath(location: string): string {
    return this.resolveLocation(location);
  }

  async delete(location: string): Promise<void> {
    const fullPath = this.resolveLocation(location);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async exists(location: string): Promise<boolean> {
    const fullPath = this.resolveLocation(location);
    return fs.existsSync(fullPath);
  }

  async getSize(location: string): Promise<number> {
    const fullPath = this.resolveLocation(location);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archive not found: ${location}`);
    }
    const stats = fs.statSync(fullPath);
    return stats.size;
  }

  /**
   * Get the archives directory path
   * Used by the provider for creating archives
   */
  getArchivesDir(): string {
    return this.archivesDir;
  }

  /**
   * Ensure the archives directory exists
   */
  async ensureArchivesDir(): Promise<string> {
    try {
      await io.mkdirP(this.archivesDir);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EACCES') {
        const parentDir = path.dirname(path.dirname(this.archivesDir));
        throw new Error(
          `Permission denied creating cache directory: ${this.archivesDir}\n\n` +
            `To fix this, either:\n` +
            `  1. Use the default cache path (recommended for non-Docker):\n` +
            `     Remove 'cache-path' input to use the platform default\n\n` +
            `  2. Fix permissions on your custom path:\n` +
            `     sudo mkdir -p ${parentDir}\n` +
            `     sudo chown -R $(whoami) ${parentDir}\n\n` +
            `  3. Set OPENCACHE_PATH env var on runners:\n` +
            `     export OPENCACHE_PATH=/path/with/write/access\n\n` +
            `  4. For Docker: mount a host volume and set cache-path\n` +
            `     See: https://github.com/amulya-labs/gha-opencache/blob/main/docs/DOCKER.md`
        );
      }
      throw err;
    }
    return this.archivesDir;
  }

  /**
   * Resolve a relative location to a full path
   */
  private resolveLocation(location: string): string {
    // Location is relative to cacheDir (e.g., 'archives/sha256-xxx.tar.zst')
    // archivesDir is cacheDir/archives, so we go up one level and join
    const cacheDir = path.dirname(this.archivesDir);
    return path.join(cacheDir, location);
  }
}

/**
 * Create a LocalStorageBackend for a cache directory
 * @param cacheDir - Cache directory path
 */
export function createLocalStorageBackend(cacheDir: string): LocalStorageBackend {
  return new LocalStorageBackend(cacheDir);
}
