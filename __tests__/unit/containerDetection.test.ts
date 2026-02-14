import * as fs from 'fs';
import { isRunningInContainer, isPathOnMountedVolume } from '../../src/utils/containerDetection';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('containerDetection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Remove container-related env vars
    delete process.env.KUBERNETES_SERVICE_HOST;
    delete process.env.CONTAINER;
    delete process.env.container;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isRunningInContainer', () => {
    it('returns true when KUBERNETES_SERVICE_HOST is set', () => {
      process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when CONTAINER env var is set', () => {
      process.env.CONTAINER = 'podman';
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when container env var is set', () => {
      process.env.container = 'systemd-nspawn';
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when /.dockerenv exists', () => {
      mockFs.existsSync.mockImplementation(path => path === '/.dockerenv');
      expect(isRunningInContainer()).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/.dockerenv');
    });

    it('returns true when /run/.containerenv exists (Podman)', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.existsSync.mockImplementation(path => path === '/run/.containerenv');
      expect(isRunningInContainer()).toBe(true);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/run/.containerenv');
    });

    it('returns true when cgroup contains docker', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('12:cpuset:/docker/abc123\n11:memory:/docker/abc123\n');
      expect(isRunningInContainer()).toBe(true);
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/proc/1/cgroup', 'utf8');
    });

    it('returns true when cgroup contains kubepods', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue(
        '12:cpuset:/kubepods/pod-abc123\n11:memory:/kubepods/pod-abc123\n'
      );
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when cgroup contains containerd', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('12:cpuset:/containerd/abc123\n');
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when cgroup contains lxc', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('12:cpuset:/lxc/container-name\n');
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns true when cgroup contains buildkit', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('12:cpuset:/buildkit/abc123\n');
      expect(isRunningInContainer()).toBe(true);
    });

    it('returns false when no container indicators are present', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockReturnValue('12:cpuset:/\n11:memory:/\n');
      expect(isRunningInContainer()).toBe(false);
    });

    it('returns false when cgroup read fails', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      expect(isRunningInContainer()).toBe(false);
    });

    it('checks environment variables before filesystem', () => {
      process.env.KUBERNETES_SERVICE_HOST = 'kubernetes.default.svc';
      expect(isRunningInContainer()).toBe(true);
      // Should not call fs methods when env var is set
      expect(mockFs.existsSync).not.toHaveBeenCalled();
    });
  });

  describe('isPathOnMountedVolume', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('returns "mounted" when path is on a bind mount', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:85 / /srv/gha-cache rw - bind /srv/gha-cache rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/srv/gha-cache')).toBe('mounted');
    });

    it('returns "mounted" when path is under a bind mount', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:85 / /srv/gha-cache rw - bind /srv/gha-cache rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/srv/gha-cache/subdir/file.txt')).toBe('mounted');
    });

    it('returns "not-mounted" when path is on overlay filesystem', () => {
      const mountinfo = '574 573 0:84 / / rw - overlay overlay rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/home/user/.cache')).toBe('not-mounted');
    });

    it('returns "not-mounted" when path is on tmpfs', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' + '575 574 0:85 / /tmp rw - tmpfs tmpfs rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/var/cache')).toBe('not-mounted');
    });

    it('returns "unknown" when mountinfo cannot be read', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(isPathOnMountedVolume('/srv/gha-cache')).toBe('unknown');
    });

    it('returns "unknown" when mountinfo is empty', () => {
      mockFs.readFileSync.mockReturnValue('');

      expect(isPathOnMountedVolume('/srv/gha-cache')).toBe('unknown');
    });

    it('chooses the most specific mount point', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:85 / /srv rw - bind /srv rw\n' +
        '576 575 0:86 / /srv/gha-cache rw - bind /srv/gha-cache rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      // Should match /srv/gha-cache, not /srv
      expect(isPathOnMountedVolume('/srv/gha-cache/archives')).toBe('mounted');
    });

    it('handles paths with trailing slashes', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:85 / /srv/gha-cache rw - bind /srv/gha-cache rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/srv/gha-cache/')).toBe('mounted');
    });

    it('normalizes relative paths', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        `575 574 0:85 / ${process.cwd()}/cache rw - bind ${process.cwd()}/cache rw\n`;
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('./cache')).toBe('mounted');
    });

    it('ignores malformed mountinfo lines', () => {
      const mountinfo =
        'malformed line\n' +
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        'incomplete - line\n' +
        '575 574 0:85 / /srv/gha-cache rw - bind /srv/gha-cache rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/srv/gha-cache')).toBe('mounted');
    });

    it('handles ext4 and other filesystem types as mounted', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 8:1 / /srv/gha-cache rw - ext4 /dev/sda1 rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/srv/gha-cache')).toBe('mounted');
    });

    it('treats NFS mounts with non-path sources as mounted', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:86 / /mnt/nfs rw - nfs4 server:/export rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/mnt/nfs')).toBe('mounted');
    });

    it('treats CIFS mounts with non-path sources as mounted', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:87 / /mnt/share rw - cifs //server/share rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/mnt/share')).toBe('mounted');
    });

    it('treats special filesystems with "none" sources as mounted', () => {
      const mountinfo =
        '574 573 0:84 / / rw - overlay overlay rw\n' +
        '575 574 0:88 / /sys/fs/cgroup rw - cgroup2 none rw\n';
      mockFs.readFileSync.mockReturnValue(mountinfo);

      expect(isPathOnMountedVolume('/sys/fs/cgroup')).toBe('mounted');
    });
  });
});
