import { isExactKeyMatch, getRepoInfo } from '../../src/utils/actionUtils';

describe('actionUtils', () => {
  describe('isExactKeyMatch', () => {
    it('returns true when keys match exactly', () => {
      expect(isExactKeyMatch('npm-abc123', 'npm-abc123')).toBe(true);
    });

    it('returns false when keys differ', () => {
      expect(isExactKeyMatch('npm-abc123', 'npm-xyz789')).toBe(false);
    });

    it('returns false when matchedKey is undefined', () => {
      expect(isExactKeyMatch('npm-abc123', undefined)).toBe(false);
    });
  });

  describe('getRepoInfo', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('extracts owner and repo from GITHUB_REPOSITORY', () => {
      process.env.GITHUB_REPOSITORY = 'my-org/my-repo';

      const { owner, repo } = getRepoInfo();

      expect(owner).toBe('my-org');
      expect(repo).toBe('my-repo');
    });

    it('throws when GITHUB_REPOSITORY is not set', () => {
      delete process.env.GITHUB_REPOSITORY;

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });

    it('throws when GITHUB_REPOSITORY format is invalid', () => {
      process.env.GITHUB_REPOSITORY = 'invalid-format';

      expect(() => getRepoInfo()).toThrow('Unable to determine repository');
    });
  });
});
