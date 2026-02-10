import * as core from '@actions/core';
import { State } from '../constants';

export interface IStateProvider {
  getState(key: string): string;
  saveState(key: string, value: string): void;
  getCacheState(): string | undefined;
}

class StateProvider implements IStateProvider {
  getState(key: string): string {
    return core.getState(key);
  }

  saveState(key: string, value: string): void {
    core.saveState(key, value);
  }

  getCacheState(): string | undefined {
    const state = this.getState(State.CacheMatchedKey);
    return state || undefined;
  }
}

class NullStateProvider implements IStateProvider {
  private stateMap = new Map<string, string>();

  getState(key: string): string {
    return this.stateMap.get(key) || '';
  }

  saveState(key: string, value: string): void {
    this.stateMap.set(key, value);
  }

  getCacheState(): string | undefined {
    const state = this.getState(State.CacheMatchedKey);
    return state || undefined;
  }
}

export function createStateProvider(isPost: boolean): IStateProvider {
  if (isPost) {
    return new StateProvider();
  }
  return new StateProvider();
}

export function createNullStateProvider(): IStateProvider {
  return new NullStateProvider();
}
