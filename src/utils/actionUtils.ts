import * as core from '@actions/core';
import { Inputs, DEFAULT_CACHE_PATH } from '../constants';

export interface ActionInputs {
  key: string;
  paths: string[];
  restoreKeys: string[];
  failOnCacheMiss: boolean;
  lookupOnly: boolean;
  saveAlways: boolean;
  cachePath: string;
}

export function getInputs(): ActionInputs {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const restoreKeys = core.getInput(Inputs.RestoreKeys).split('\n').filter(Boolean);
  const failOnCacheMiss = core.getBooleanInput(Inputs.FailOnCacheMiss);
  const lookupOnly = core.getBooleanInput(Inputs.LookupOnly);
  const saveAlways = core.getBooleanInput(Inputs.SaveAlways);
  const cachePath = core.getInput(Inputs.CachePath) || DEFAULT_CACHE_PATH;

  return {
    key,
    paths,
    restoreKeys,
    failOnCacheMiss,
    lookupOnly,
    saveAlways,
    cachePath,
  };
}

export function getRestoreInputs(): Pick<
  ActionInputs,
  'key' | 'paths' | 'restoreKeys' | 'failOnCacheMiss' | 'lookupOnly' | 'cachePath'
> {
  return getInputs();
}

export function getSaveInputs(): Pick<ActionInputs, 'key' | 'paths' | 'cachePath'> {
  const key = core.getInput(Inputs.Key, { required: true });
  const paths = core.getInput(Inputs.Path, { required: true }).split('\n').filter(Boolean);
  const cachePath = core.getInput(Inputs.CachePath) || DEFAULT_CACHE_PATH;

  return { key, paths, cachePath };
}

export function getRepoInfo(): { owner: string; repo: string } {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) {
    throw new Error(
      'Unable to determine repository. Ensure GITHUB_REPOSITORY environment variable is set.'
    );
  }
  return { owner, repo };
}

export function isExactKeyMatch(key: string, matchedKey: string | undefined): boolean {
  return key === matchedKey;
}
