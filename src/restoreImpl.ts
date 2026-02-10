import * as core from '@actions/core';
import { createStorageProvider } from './storage/factory';
import {
  getRestoreInputs,
  getRepoInfo,
  isExactKeyMatch,
  createRestoreStorageConfig,
} from './utils/actionUtils';
import { IStateProvider } from './utils/stateProvider';
import { Outputs, State } from './constants';

export interface RestoreResult {
  cacheHit: boolean;
  matchedKey: string | undefined;
}

export async function restoreCache(stateProvider: IStateProvider): Promise<RestoreResult> {
  const inputs = getRestoreInputs();
  const { owner, repo } = getRepoInfo();

  core.info(`Restoring cache for key: ${inputs.key}`);
  if (inputs.restoreKeys.length > 0) {
    core.info(`Restore keys: ${inputs.restoreKeys.join(', ')}`);
  }
  core.info(`Storage provider: ${inputs.storageProvider}`);

  // Create storage provider using factory
  const storageConfig = createRestoreStorageConfig(inputs, owner, repo);
  const storage = await createStorageProvider(storageConfig);

  // Save primary key in state for post action
  stateProvider.saveState(State.CachePrimaryKey, inputs.key);
  stateProvider.saveState(State.CachePaths, JSON.stringify(inputs.paths));

  // Resolve cache key
  const result = await storage.resolve(inputs.key, inputs.restoreKeys);

  if (!result.entry) {
    core.info('Cache not found');

    if (inputs.failOnCacheMiss) {
      throw new Error(`Cache not found for key: ${inputs.key}`);
    }

    // Set outputs
    core.setOutput(Outputs.CacheHit, 'false');
    core.setOutput(Outputs.CachePrimaryKey, inputs.key);

    return { cacheHit: false, matchedKey: undefined };
  }

  const cacheHit = isExactKeyMatch(inputs.key, result.matchedKey);

  core.info(`Cache ${cacheHit ? 'hit' : 'restored'} for key: ${result.matchedKey}`);

  // Save matched key in state
  stateProvider.saveState(State.CacheMatchedKey, result.matchedKey || '');

  if (!inputs.lookupOnly) {
    await storage.restore(result.entry);
  } else {
    core.info('Lookup only - skipping restore');
  }

  // Set outputs
  core.setOutput(Outputs.CacheHit, cacheHit.toString());
  core.setOutput(Outputs.CachePrimaryKey, inputs.key);
  core.setOutput(Outputs.CacheMatchedKey, result.matchedKey);

  return { cacheHit, matchedKey: result.matchedKey };
}
