import * as core from '@actions/core';
import { saveCache } from './saveImpl';
import { createStateProvider } from './utils/stateProvider';

async function run(): Promise<void> {
  try {
    const stateProvider = createStateProvider(true);
    await saveCache(stateProvider);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}

run();
