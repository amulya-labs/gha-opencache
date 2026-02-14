import * as core from '@actions/core';
import {
  IStateProvider,
  createStateProvider,
  createNullStateProvider,
} from '../../src/utils/stateProvider';
import { State } from '../../src/constants';

jest.mock('@actions/core');

describe('stateProvider', () => {
  const mockCore = core as jest.Mocked<typeof core>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('StateProvider', () => {
    let stateProvider: IStateProvider;

    beforeEach(() => {
      stateProvider = createStateProvider(false);
    });

    describe('getState', () => {
      it('should call core.getState with the correct key', () => {
        mockCore.getState.mockReturnValue('test-value');

        const result = stateProvider.getState('TEST_KEY');

        expect(mockCore.getState).toHaveBeenCalledWith('TEST_KEY');
        expect(result).toBe('test-value');
      });

      it('should return empty string when state is not set', () => {
        mockCore.getState.mockReturnValue('');

        const result = stateProvider.getState('MISSING_KEY');

        expect(result).toBe('');
      });
    });

    describe('saveState', () => {
      it('should call core.saveState with the correct key and value', () => {
        stateProvider.saveState('TEST_KEY', 'test-value');

        expect(mockCore.saveState).toHaveBeenCalledWith('TEST_KEY', 'test-value');
      });

      it('should handle empty values', () => {
        stateProvider.saveState('TEST_KEY', '');

        expect(mockCore.saveState).toHaveBeenCalledWith('TEST_KEY', '');
      });
    });

    describe('getCacheState', () => {
      it('should return matched key from state', () => {
        mockCore.getState.mockReturnValue('npm-abc123');

        const result = stateProvider.getCacheState();

        expect(mockCore.getState).toHaveBeenCalledWith(State.CacheMatchedKey);
        expect(result).toBe('npm-abc123');
      });

      it('should return undefined when state is empty', () => {
        mockCore.getState.mockReturnValue('');

        const result = stateProvider.getCacheState();

        expect(result).toBeUndefined();
      });
    });
  });

  describe('NullStateProvider', () => {
    let nullStateProvider: IStateProvider;

    beforeEach(() => {
      nullStateProvider = createNullStateProvider();
    });

    describe('getState', () => {
      it('should return empty string for unset keys', () => {
        const result = nullStateProvider.getState('TEST_KEY');

        expect(result).toBe('');
      });

      it('should return saved value for set keys', () => {
        nullStateProvider.saveState('TEST_KEY', 'test-value');

        const result = nullStateProvider.getState('TEST_KEY');

        expect(result).toBe('test-value');
      });
    });

    describe('saveState', () => {
      it('should save state in memory', () => {
        nullStateProvider.saveState('TEST_KEY', 'test-value');

        expect(nullStateProvider.getState('TEST_KEY')).toBe('test-value');
      });

      it('should overwrite existing values', () => {
        nullStateProvider.saveState('TEST_KEY', 'first-value');
        nullStateProvider.saveState('TEST_KEY', 'second-value');

        expect(nullStateProvider.getState('TEST_KEY')).toBe('second-value');
      });

      it('should handle multiple keys independently', () => {
        nullStateProvider.saveState('KEY_1', 'value-1');
        nullStateProvider.saveState('KEY_2', 'value-2');

        expect(nullStateProvider.getState('KEY_1')).toBe('value-1');
        expect(nullStateProvider.getState('KEY_2')).toBe('value-2');
      });

      it('should handle empty values', () => {
        nullStateProvider.saveState('TEST_KEY', 'initial');
        nullStateProvider.saveState('TEST_KEY', '');

        expect(nullStateProvider.getState('TEST_KEY')).toBe('');
      });
    });

    describe('getCacheState', () => {
      it('should return matched key from memory state', () => {
        nullStateProvider.saveState(State.CacheMatchedKey, 'npm-abc123');

        const result = nullStateProvider.getCacheState();

        expect(result).toBe('npm-abc123');
      });

      it('should return undefined when state is empty', () => {
        const result = nullStateProvider.getCacheState();

        expect(result).toBeUndefined();
      });

      it('should return undefined when state is empty string', () => {
        nullStateProvider.saveState(State.CacheMatchedKey, '');

        const result = nullStateProvider.getCacheState();

        expect(result).toBeUndefined();
      });
    });

    describe('isolation', () => {
      it('should maintain separate state across multiple instances', () => {
        const provider1 = createNullStateProvider();
        const provider2 = createNullStateProvider();

        provider1.saveState('TEST_KEY', 'value-1');
        provider2.saveState('TEST_KEY', 'value-2');

        expect(provider1.getState('TEST_KEY')).toBe('value-1');
        expect(provider2.getState('TEST_KEY')).toBe('value-2');
      });
    });
  });

  describe('createStateProvider', () => {
    it('should return StateProvider when isPost is true', () => {
      mockCore.getState.mockReturnValue('test-value');

      const provider = createStateProvider(true);
      const result = provider.getState('TEST_KEY');

      expect(mockCore.getState).toHaveBeenCalledWith('TEST_KEY');
      expect(result).toBe('test-value');
    });

    it('should return StateProvider when isPost is false', () => {
      mockCore.getState.mockReturnValue('test-value');

      const provider = createStateProvider(false);
      const result = provider.getState('TEST_KEY');

      expect(mockCore.getState).toHaveBeenCalledWith('TEST_KEY');
      expect(result).toBe('test-value');
    });
  });

  describe('createNullStateProvider', () => {
    it('should return NullStateProvider instance', () => {
      const provider = createNullStateProvider();

      provider.saveState('TEST_KEY', 'test-value');
      const result = provider.getState('TEST_KEY');

      expect(result).toBe('test-value');
      expect(mockCore.getState).not.toHaveBeenCalled();
      expect(mockCore.saveState).not.toHaveBeenCalled();
    });

    it('should create independent instances', () => {
      const provider1 = createNullStateProvider();
      const provider2 = createNullStateProvider();

      provider1.saveState('KEY', 'value1');
      provider2.saveState('KEY', 'value2');

      expect(provider1.getState('KEY')).toBe('value1');
      expect(provider2.getState('KEY')).toBe('value2');
    });
  });

  describe('integration scenarios', () => {
    it('should handle cache workflow with StateProvider', () => {
      mockCore.getState.mockImplementation((key: string) => {
        if (key === State.CachePrimaryKey) return 'npm-abc123';
        if (key === State.CacheMatchedKey) return 'npm-xyz789';
        return '';
      });

      const provider = createStateProvider(false);

      provider.saveState(State.CachePrimaryKey, 'npm-abc123');
      provider.saveState(State.CacheMatchedKey, 'npm-xyz789');

      expect(provider.getState(State.CachePrimaryKey)).toBe('npm-abc123');
      expect(provider.getCacheState()).toBe('npm-xyz789');
    });

    it('should handle cache workflow with NullStateProvider', () => {
      const provider = createNullStateProvider();

      provider.saveState(State.CachePrimaryKey, 'npm-abc123');
      provider.saveState(State.CacheMatchedKey, 'npm-xyz789');
      provider.saveState(State.CachePaths, JSON.stringify(['/path/to/cache']));

      expect(provider.getState(State.CachePrimaryKey)).toBe('npm-abc123');
      expect(provider.getCacheState()).toBe('npm-xyz789');
      expect(provider.getState(State.CachePaths)).toBe(JSON.stringify(['/path/to/cache']));
    });

    it('should handle cache miss scenario', () => {
      const provider = createNullStateProvider();

      provider.saveState(State.CachePrimaryKey, 'npm-abc123');

      expect(provider.getState(State.CachePrimaryKey)).toBe('npm-abc123');
      expect(provider.getCacheState()).toBeUndefined();
    });
  });
});
