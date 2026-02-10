import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  CompressionOptions,
  resolveCompressionMethod,
  getArchiveExtension,
  compressArchive,
  decompressArchive,
  getCompressionMethodFromPath,
} from './compression';

export interface CreateArchiveResult {
  archivePath: string;
  hash: string;
  sizeBytes: number;
}

export async function createArchive(
  paths: string[],
  archiveDir: string,
  workingDir?: string,
  compressionOptions?: CompressionOptions
): Promise<CreateArchiveResult> {
  // Resolve compression method and level
  const options = compressionOptions || { method: 'auto' };
  const { method, level } = await resolveCompressionMethod(options);

  const tempTarPath = path.join(archiveDir, `cache-${Date.now()}.tar`);
  const resolvedPaths = await resolvePaths(paths);

  if (resolvedPaths.length === 0) {
    throw new Error('No files found to cache');
  }

  const cwd = workingDir || process.cwd();

  // Create manifest file for tar
  const manifestPath = path.join(archiveDir, `manifest-${Date.now()}.txt`);
  const relativePaths = resolvedPaths.map(p => path.relative(cwd, p));
  fs.writeFileSync(manifestPath, relativePaths.join('\n'));

  try {
    await exec.exec('tar', ['-cf', tempTarPath, '-C', cwd, '-T', manifestPath]);
  } finally {
    await io.rmRF(manifestPath);
  }

  // Compress (or copy if 'none')
  const extension = getArchiveExtension(method);
  const hash = await computeFileHash(tempTarPath);
  const finalArchivePath = path.join(archiveDir, `sha256-${hash}${extension}`);

  await compressArchive(tempTarPath, finalArchivePath, method, level);
  await io.rmRF(tempTarPath);

  const stats = fs.statSync(finalArchivePath);

  return {
    archivePath: finalArchivePath,
    hash,
    sizeBytes: stats.size,
  };
}

export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  const compressionMethod = getCompressionMethodFromPath(archivePath);
  const tempTarPath = path.join(path.dirname(archivePath), `extract-${Date.now()}.tar`);

  try {
    await decompressArchive(archivePath, tempTarPath, compressionMethod);
    await exec.exec('tar', ['-xf', tempTarPath, '-C', targetDir]);
  } finally {
    await io.rmRF(tempTarPath);
  }
}

async function resolvePaths(patterns: string[]): Promise<string[]> {
  const globber = await glob.create(patterns.join('\n'), {
    implicitDescendants: false,
  });
  const files = await globber.glob();
  return files;
}

async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 16)));
    stream.on('error', reject);
  });
}
