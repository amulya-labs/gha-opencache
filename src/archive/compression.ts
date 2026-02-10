import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { DEFAULT_ZSTD_LEVEL, DEFAULT_GZIP_LEVEL } from '../constants';

export type CompressionMethod = 'zstd' | 'gzip' | 'none';

export interface CompressionOptions {
  method: CompressionMethod | 'auto';
  level?: number;
}

/**
 * Detect available compression method
 */
export async function detectCompressionMethod(): Promise<CompressionMethod> {
  try {
    await io.which('zstd', true);
    return 'zstd';
  } catch {
    core.debug('zstd not found, falling back to gzip');
    return 'gzip';
  }
}

/**
 * Check if a specific compression tool is available
 */
export async function isCompressionAvailable(method: CompressionMethod): Promise<boolean> {
  if (method === 'none' || method === 'gzip') {
    // gzip is handled via Node.js zlib, always available
    return true;
  }
  try {
    await io.which(method, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve 'auto' to an actual compression method, or validate explicit method
 */
export async function resolveCompressionMethod(
  options: CompressionOptions
): Promise<{ method: CompressionMethod; level: number }> {
  let method: CompressionMethod;

  if (options.method === 'auto') {
    method = await detectCompressionMethod();
  } else {
    method = options.method;
    // Validate that the explicit method is available
    if (method !== 'none' && method !== 'gzip') {
      const available = await isCompressionAvailable(method);
      if (!available) {
        throw new Error(
          `Compression method '${method}' is not available. Please install ${method} or use 'auto' for automatic detection.`
        );
      }
    }
  }

  // Determine and validate level
  let level: number;
  if (method === 'none') {
    level = 0;
  } else if (method === 'zstd') {
    level = options.level ?? DEFAULT_ZSTD_LEVEL;
    // zstd supports levels 1-19 (and up to 22 with --ultra)
    if (level < 1 || level > 19) {
      core.warning(`Invalid zstd compression level ${level}, clamping to valid range (1-19)`);
      level = Math.max(1, Math.min(19, level));
    }
  } else {
    // gzip
    level = options.level ?? DEFAULT_GZIP_LEVEL;
    // gzip supports levels 1-9
    if (level < 1 || level > 9) {
      core.warning(`Invalid gzip compression level ${level}, clamping to valid range (1-9)`);
      level = Math.max(1, Math.min(9, level));
    }
  }

  return { method, level };
}

export function getArchiveExtension(method: CompressionMethod): string {
  switch (method) {
    case 'zstd':
      return '.tar.zst';
    case 'gzip':
      return '.tar.gz';
    case 'none':
      return '.tar';
  }
}

export async function compressArchive(
  tarPath: string,
  outputPath: string,
  method: CompressionMethod,
  level?: number
): Promise<void> {
  if (method === 'zstd') {
    const compressionLevel = level ?? DEFAULT_ZSTD_LEVEL;
    await exec.exec('zstd', [
      '-f', // Force overwrite if file exists
      `-${compressionLevel}`,
      '-T0',
      '--long=30',
      '-o',
      outputPath,
      tarPath,
    ]);
  } else if (method === 'gzip') {
    // Use Node.js zlib for reliable cross-platform gzip compression
    const compressionLevel = level ?? DEFAULT_GZIP_LEVEL;
    const gzip = zlib.createGzip({ level: compressionLevel });
    await pipeline(fs.createReadStream(tarPath), gzip, fs.createWriteStream(outputPath));
  } else {
    // none - just copy the tar file
    await fs.promises.copyFile(tarPath, outputPath);
  }
}

export async function decompressArchive(
  archivePath: string,
  outputPath: string,
  method: CompressionMethod
): Promise<void> {
  if (method === 'zstd') {
    await exec.exec('zstd', ['-d', '-o', outputPath, archivePath]);
  } else if (method === 'gzip') {
    // Use Node.js zlib for reliable cross-platform gzip decompression
    const gunzip = zlib.createGunzip();
    await pipeline(fs.createReadStream(archivePath), gunzip, fs.createWriteStream(outputPath));
  } else {
    // none - just copy the tar file
    await fs.promises.copyFile(archivePath, outputPath);
  }
}

export function getCompressionMethodFromPath(archivePath: string): CompressionMethod {
  if (archivePath.endsWith('.tar.zst') || archivePath.endsWith('.zst')) {
    return 'zstd';
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.gz')) {
    return 'gzip';
  }
  return 'none';
}
