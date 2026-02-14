import * as core from '@actions/core';
import { isRunningInContainer, isPathOnMountedVolume } from './containerDetection';
import type { RestoreInputs } from './actionUtils';

/**
 * Emit a warning if running in a container with a likely misconfigured cache path.
 *
 * This helps users diagnose cache misses caused by:
 * - Using default cache path in containers (v1 to v2 upgrade issue)
 * - Setting explicit cache-path but forgetting to mount it as a volume
 * - Typos in cache-path or volume mount configuration
 *
 * The warning is only emitted when:
 * 1. Running inside a container (detected via multiple methods)
 * 2. Using local storage provider (remote providers don't need volume mounts)
 * 3. Experiencing a cache miss (no warning if cache is working)
 *
 * @param inputs Restore inputs containing storage provider, cache path, and configuration
 */
export function maybeWarnContainerConfig(inputs: RestoreInputs): void {
  // Only warn for local storage in containers
  if (inputs.storageProvider !== 'local') return;
  if (!isRunningInContainer()) return;

  const mountStatus = isPathOnMountedVolume(inputs.cachePath);

  if (inputs.isExplicitCachePath) {
    // User explicitly set cache-path but still got cache miss
    let message = `Cache miss in container using cache path: ${inputs.cachePath}\n\n`;

    switch (mountStatus) {
      case 'not-mounted':
        message +=
          '❌ This path does NOT appear to be mounted as a volume!\n' +
          "The cache is stored in the container's ephemeral filesystem and\n" +
          'will be lost when the container exits.\n\n' +
          'Add a volume mount in your workflow:\n' +
          '  container:\n' +
          '    volumes:\n' +
          `      - ${inputs.cachePath}:${inputs.cachePath}\n\n` +
          'Ensure the host directory exists and has correct permissions.';
        break;

      case 'mounted':
        message +=
          '✅ Path appears to be mounted as a volume.\n' +
          'If this is the first run, this cache miss is expected.\n' +
          'Otherwise, verify:\n' +
          '1. The host directory exists and has correct permissions\n' +
          '2. The cache key matches previous runs\n' +
          '3. The volume mount paths are correct in your workflow';
        break;

      case 'unknown':
        message +=
          '⚠️  Unable to detect mount status. Please verify:\n' +
          '1. The cache path is mounted as a volume\n' +
          '2. The volume mount paths match exactly\n' +
          '  container:\n' +
          '    volumes:\n' +
          `      - ${inputs.cachePath}:${inputs.cachePath}\n\n` +
          '3. The host directory exists and has correct permissions';
        break;
    }

    message += '\n\nSee: https://github.com/amulya-labs/gha-opencache/blob/main/docs/DOCKER.md';

    // Use appropriate severity based on mount status
    if (mountStatus === 'mounted') {
      core.info(message);  // Reassurance - everything is OK
    } else if (mountStatus === 'not-mounted') {
      core.warning(message);  // Problem detected
    } else {
      core.notice(message);  // Unknown status - verification needed
    }
  } else {
    // User is using default path (common v1→v2 upgrade issue)
    core.warning(
      `Cache miss in container using default cache path: ${inputs.cachePath}\n\n` +
        `❌ Default path is NOT mounted (detected: ${mountStatus})\n\n` +
        'Container filesystems are isolated - the default cache path is inside\n' +
        'the container and will not persist between jobs. Common causes:\n' +
        '- Upgrading from v1 (which used /srv/gha-cache by default)\n' +
        '- No cache-path input specified\n\n' +
        'To fix, add an explicit cache-path with a mounted volume:\n\n' +
        '  - uses: amulya-labs/gha-opencache@v2\n' +
        '    with:\n' +
        '      cache-path: /srv/gha-cache  # or your preferred path\n\n' +
        '  container:\n' +
        '    volumes:\n' +
        '      - /srv/gha-cache:/srv/gha-cache\n\n' +
        'See: https://github.com/amulya-labs/gha-opencache/blob/main/docs/DOCKER.md'
    );
  }
}
