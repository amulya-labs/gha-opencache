import * as core from '@actions/core';
import { saveCacheOnly } from './saveImpl';

async function run(): Promise<void> {
  try {
    await saveCacheOnly();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}

run();
