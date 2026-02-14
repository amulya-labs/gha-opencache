import * as core from '@actions/core';
import { maybeWarnContainerConfig } from '../../src/utils/containerWarnings';
import * as containerDetection from '../../src/utils/containerDetection';
import type { RestoreInputs } from '../../src/utils/actionUtils';

// Mock dependencies
jest.mock('@actions/core');
jest.mock('../../src/utils/containerDetection');

const mockCore = core as jest.Mocked<typeof core>;
const mockContainerDetection = containerDetection as jest.Mocked<typeof containerDetection>;

describe('containerWarnings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockInputs = (overrides?: Partial<RestoreInputs>): RestoreInputs => ({
    key: 'test-key',
    paths: ['/tmp/test'],
    restoreKeys: [],
    failOnCacheMiss: false,
    lookupOnly: false,
    storageProvider: 'local',
    cachePath: '/srv/gha-cache',
    isExplicitCachePath: true,
    s3: {
      bucket: '',
      region: 'us-east-1',
      prefix: 'gha-cache/',
      forcePathStyle: false,
    },
    gcs: {
      bucket: '',
      prefix: 'gha-cache/',
    },
    ...overrides,
  });

  describe('maybeWarnContainerConfig', () => {
    it('does not warn when storage provider is not local', () => {
      const inputs = createMockInputs({ storageProvider: 's3' });
      mockContainerDetection.isRunningInContainer.mockReturnValue(true);

      maybeWarnContainerConfig(inputs);

      expect(mockCore.warning).not.toHaveBeenCalled();
    });

    it('does not warn when not running in a container', () => {
      const inputs = createMockInputs();
      mockContainerDetection.isRunningInContainer.mockReturnValue(false);

      maybeWarnContainerConfig(inputs);

      expect(mockCore.warning).not.toHaveBeenCalled();
    });

    describe('explicit cache-path', () => {
      it('warns when path is not mounted', () => {
        const inputs = createMockInputs({
          cachePath: '/srv/gha-cache',
          isExplicitCachePath: true,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        expect(mockCore.warning).toHaveBeenCalledTimes(1);
        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain('Cache miss in container using cache path');
        expect(warningMessage).toContain('/srv/gha-cache');
        expect(warningMessage).toContain('❌');
        expect(warningMessage).toContain('NOT appear to be mounted as a volume');
        expect(warningMessage).toContain('Add a volume mount');
      });

      it('uses info level when path is mounted (reassurance)', () => {
        const inputs = createMockInputs({
          cachePath: '/srv/gha-cache',
          isExplicitCachePath: true,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('mounted');

        maybeWarnContainerConfig(inputs);

        expect(mockCore.info).toHaveBeenCalledTimes(1);
        expect(mockCore.warning).not.toHaveBeenCalled();
        const infoMessage = mockCore.info.mock.calls[0][0];
        expect(infoMessage).toContain('Cache miss in container using cache path');
        expect(infoMessage).toContain('/srv/gha-cache');
        expect(infoMessage).toContain('✅');
        expect(infoMessage).toContain('appears to be mounted as a volume');
        expect(infoMessage).toContain('If this is the first run');
      });

      it('uses notice level when mount status is unknown', () => {
        const inputs = createMockInputs({
          cachePath: '/srv/gha-cache',
          isExplicitCachePath: true,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('unknown');

        maybeWarnContainerConfig(inputs);

        expect(mockCore.notice).toHaveBeenCalledTimes(1);
        expect(mockCore.warning).not.toHaveBeenCalled();
        const noticeMessage = mockCore.notice.mock.calls[0][0];
        expect(noticeMessage).toContain('Cache miss in container using cache path');
        expect(noticeMessage).toContain('/srv/gha-cache');
        expect(noticeMessage).toContain('⚠️');
        expect(noticeMessage).toContain('Unable to detect mount status');
        expect(noticeMessage).toContain('Please verify');
      });

      it('includes documentation link in all messages', () => {
        const inputs = createMockInputs({
          cachePath: '/srv/gha-cache',
          isExplicitCachePath: true,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain(
          'https://github.com/amulya-labs/gha-opencache/blob/main/docs/DOCKER.md'
        );
      });
    });

    describe('default cache-path', () => {
      it('warns with v1→v2 upgrade guidance', () => {
        const inputs = createMockInputs({
          cachePath: '/github/home/.cache/gha-opencache',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        expect(mockCore.warning).toHaveBeenCalledTimes(1);
        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain('using default cache path');
        expect(warningMessage).toContain('/github/home/.cache/gha-opencache');
        expect(warningMessage).toContain('❌');
        expect(warningMessage).toContain('Default path is NOT mounted');
        expect(warningMessage).toContain('Upgrading from v1');
        expect(warningMessage).toContain('add an explicit cache-path');
        expect(warningMessage).toContain('cache-path: /srv/gha-cache');
      });

      it('includes mount status in warning', () => {
        const inputs = createMockInputs({
          cachePath: '/github/home/.cache/gha-opencache',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain('detected: not-mounted');
      });

      it('includes full example configuration', () => {
        const inputs = createMockInputs({
          cachePath: '/github/home/.cache/gha-opencache',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain('- uses: amulya-labs/gha-opencache@v2');
        expect(warningMessage).toContain('with:');
        expect(warningMessage).toContain('cache-path: /srv/gha-cache');
        expect(warningMessage).toContain('container:');
        expect(warningMessage).toContain('volumes:');
        expect(warningMessage).toContain('- /srv/gha-cache:/srv/gha-cache');
      });

      it('includes documentation link', () => {
        const inputs = createMockInputs({
          cachePath: '/github/home/.cache/gha-opencache',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('not-mounted');

        maybeWarnContainerConfig(inputs);

        const warningMessage = mockCore.warning.mock.calls[0][0];
        expect(warningMessage).toContain(
          'https://github.com/amulya-labs/gha-opencache/blob/main/docs/DOCKER.md'
        );
      });
    });

    describe('combined conditions', () => {
      it('does not warn for GCS provider even in container', () => {
        const inputs = createMockInputs({
          storageProvider: 'gcs',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);

        maybeWarnContainerConfig(inputs);

        expect(mockCore.warning).not.toHaveBeenCalled();
      });

      it('does not warn for local storage outside container', () => {
        const inputs = createMockInputs({
          storageProvider: 'local',
          isExplicitCachePath: false,
        });
        mockContainerDetection.isRunningInContainer.mockReturnValue(false);

        maybeWarnContainerConfig(inputs);

        expect(mockCore.warning).not.toHaveBeenCalled();
      });

      it('calls detection functions in correct order', () => {
        const inputs = createMockInputs();
        mockContainerDetection.isRunningInContainer.mockReturnValue(false);

        maybeWarnContainerConfig(inputs);

        // Should check if in container first
        expect(mockContainerDetection.isRunningInContainer).toHaveBeenCalled();
        // Should not check mount status if not in container
        expect(mockContainerDetection.isPathOnMountedVolume).not.toHaveBeenCalled();
      });

      it('checks mount status when in container', () => {
        const inputs = createMockInputs({ cachePath: '/srv/gha-cache' });
        mockContainerDetection.isRunningInContainer.mockReturnValue(true);
        mockContainerDetection.isPathOnMountedVolume.mockReturnValue('mounted');

        maybeWarnContainerConfig(inputs);

        expect(mockContainerDetection.isPathOnMountedVolume).toHaveBeenCalledWith('/srv/gha-cache');
        // Should use info level for mounted path
        expect(mockCore.info).toHaveBeenCalledTimes(1);
      });
    });
  });
});
