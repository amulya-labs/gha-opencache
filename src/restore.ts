import * as core from '@actions/core';
import { restoreCache } from './restoreImpl';
import { createStateProvider } from './utils/stateProvider';

async function run(): Promise<void> {
  try {
    const stateProvider = createStateProvider(false);
    await restoreCache(stateProvider);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}

run();
