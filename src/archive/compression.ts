import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as core from '@actions/core';
import * as fs from 'fs';

export type CompressionMethod = 'zstd' | 'gzip';

export async function detectCompressionMethod(): Promise<CompressionMethod> {
  try {
    await io.which('zstd', true);
    return 'zstd';
  } catch {
    core.debug('zstd not found, falling back to gzip');
    return 'gzip';
  }
}

export function getArchiveExtension(method: CompressionMethod): string {
  return method === 'zstd' ? '.tar.zst' : '.tar.gz';
}

export async function compressArchive(
  tarPath: string,
  outputPath: string,
  method: CompressionMethod
): Promise<void> {
  if (method === 'zstd') {
    await exec.exec('zstd', ['-T0', '--long=30', '-o', outputPath, tarPath]);
  } else {
    await exec.exec('gzip', ['-c', tarPath], {
      outStream: fs.createWriteStream(outputPath),
    });
  }
}

export async function decompressArchive(
  archivePath: string,
  outputPath: string,
  method: CompressionMethod
): Promise<void> {
  if (method === 'zstd') {
    await exec.exec('zstd', ['-d', '-o', outputPath, archivePath]);
  } else {
    await exec.exec('gzip', ['-d', '-c', archivePath], {
      outStream: fs.createWriteStream(outputPath),
    });
  }
}

export function getCompressionMethodFromPath(archivePath: string): CompressionMethod {
  if (archivePath.endsWith('.tar.zst') || archivePath.endsWith('.zst')) {
    return 'zstd';
  }
  return 'gzip';
}
