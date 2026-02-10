import * as core from '@actions/core';
import { createStorageProvider } from './storage/factory';
import {
  getSaveInputs,
  getRepoInfo,
  isExactKeyMatch,
  createSaveStorageConfig,
} from './utils/actionUtils';
import { IStateProvider } from './utils/stateProvider';
import { State } from './constants';

export interface SaveResult {
  saved: boolean;
  key: string;
}

export async function saveCache(stateProvider: IStateProvider): Promise<SaveResult> {
  const inputs = getSaveInputs();
  const { owner, repo } = getRepoInfo();

  // Get state from restore phase
  const primaryKey = stateProvider.getState(State.CachePrimaryKey) || inputs.key;
  const matchedKey = stateProvider.getCacheState();
  const savedPaths = stateProvider.getState(State.CachePaths);
  const paths = savedPaths ? JSON.parse(savedPaths) : inputs.paths;

  // Check if we had an exact cache hit - no need to save
  if (isExactKeyMatch(primaryKey, matchedKey)) {
    core.info(`Cache hit on primary key ${primaryKey}, skipping save`);
    return { saved: false, key: primaryKey };
  }

  core.info(`Saving cache for key: ${primaryKey}`);
  core.info(`Storage provider: ${inputs.storageProvider}`);

  // Create storage provider using factory
  const storageConfig = createSaveStorageConfig(inputs, owner, repo);
  const storage = await createStorageProvider(storageConfig);

  try {
    await storage.save(primaryKey, paths);
    core.info(`Cache saved successfully for key: ${primaryKey}`);
    return { saved: true, key: primaryKey };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to save cache: ${errorMessage}`);
    return { saved: false, key: primaryKey };
  }
}

export async function saveCacheOnly(): Promise<SaveResult> {
  const inputs = getSaveInputs();
  const { owner, repo } = getRepoInfo();

  core.info(`Saving cache for key: ${inputs.key}`);
  core.info(`Storage provider: ${inputs.storageProvider}`);

  // Create storage provider using factory
  const storageConfig = createSaveStorageConfig(inputs, owner, repo);
  const storage = await createStorageProvider(storageConfig);

  try {
    await storage.save(inputs.key, inputs.paths);
    core.info(`Cache saved successfully for key: ${inputs.key}`);
    return { saved: true, key: inputs.key };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.warning(`Failed to save cache: ${errorMessage}`);
    return { saved: false, key: inputs.key };
  }
}
