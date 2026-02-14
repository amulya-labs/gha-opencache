import * as fs from 'fs';
import * as path from 'path';

/**
 * Mount information from /proc/self/mountinfo
 */
interface MountInfo {
  mountPoint: string;
  fsType: string;
}

/**
 * Detect if the current process is running inside a container.
 * Uses multiple detection methods for reliability across different container runtimes.
 *
 * @returns true if running in a container, false otherwise
 */
export function isRunningInContainer(): boolean {
  // Fast path: check environment variables first (instant check)
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  if (process.env.CONTAINER || process.env.container) return true;

  // Check for Docker marker file
  if (fs.existsSync('/.dockerenv')) return true;

  // Check for Podman marker file
  if (fs.existsSync('/run/.containerenv')) return true;

  // Check cgroup for container signatures (works for Docker, Kubernetes, containerd, etc.)
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|kubepods|containerd|lxc|buildkit/i.test(cgroup)) return true;
  } catch {
    // Not on Linux or no access - likely not a container
  }

  return false;
}

/**
 * Parse mount information from /proc/self/mountinfo
 *
 * @returns Array of mount information, or empty array if unable to parse
 */
function parseMountInfo(): MountInfo[] {
  try {
    const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    const mounts: MountInfo[] = [];

    for (const line of mountinfo.split('\n')) {
      if (!line.trim()) continue;

      // Format: mountid parentid major:minor root mountpoint options - fstype source options
      const parts = line.split(' ');
      if (parts.length < 7) continue;

      const mountPoint = parts[4];
      const sepIndex = parts.indexOf('-');
      // Ensure we have both fsType and source fields after the separator
      if (sepIndex === -1 || sepIndex + 2 >= parts.length) continue;

      const fsType = parts[sepIndex + 1];

      mounts.push({
        mountPoint,
        fsType,
      });
    }

    return mounts;
  } catch {
    // Unable to read mountinfo (not Linux, permission denied, etc.)
    return [];
  }
}

/**
 * Check if a path is on a mounted volume (not container's ephemeral filesystem).
 *
 * This is useful for detecting if a cache path in a container is properly mounted
 * as a volume, which is required for persistence between container runs.
 *
 * @param targetPath The path to check
 * @returns 'mounted' if path is on a bind mount, 'not-mounted' if on ephemeral filesystem, 'unknown' if unable to detect
 */
export function isPathOnMountedVolume(targetPath: string): 'mounted' | 'not-mounted' | 'unknown' {
  const mounts = parseMountInfo();
  if (mounts.length === 0) return 'unknown'; // Can't read mountinfo

  // Normalize path to absolute
  const normalizedPath = path.resolve(targetPath);

  // Find the longest matching mount point (most specific)
  let bestMatch: MountInfo | null = null;
  let bestMatchLength = 0;

  for (const mount of mounts) {
    // Skip overlay/tmpfs (container's ephemeral filesystem)
    if (mount.fsType === 'overlay' || mount.fsType === 'tmpfs') continue;

    // Check if path is under this mount, ensuring we match at path boundaries
    // to avoid false positives (e.g., /srv shouldn't match /service)
    const isUnderMount =
      normalizedPath.startsWith(mount.mountPoint) &&
      (normalizedPath.length === mount.mountPoint.length ||
        normalizedPath[mount.mountPoint.length] === '/');

    if (isUnderMount && mount.mountPoint.length > bestMatchLength) {
      bestMatch = mount;
      bestMatchLength = mount.mountPoint.length;
    }
  }

  // If we found a non-overlay, non-tmpfs mount, it's persistent storage
  // This includes bind mounts, device mounts (ext4, xfs), and network mounts (nfs, cifs)
  if (bestMatch) return 'mounted';

  // Path is on overlay/tmpfs (ephemeral container filesystem)
  // Note: In GitHub Actions containers, the root filesystem ("/") is typically overlay/tmpfs
  // and is correctly treated as ephemeral. This function returns 'not-mounted' for paths
  // that don't have an explicit non-ephemeral mount point.
  return 'not-mounted';
}
