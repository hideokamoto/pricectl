import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_STRIPE_API_VERSION, STRIPE_API_KEY_MISSING_ERROR, StackManifest } from '@pricectl/core';

/** A stack definition loaded from the user's app file, ready to be planned. */
export interface LoadedApp {
  manifest: StackManifest;
  apiKey: string;
  apiVersion: string;
}

interface StackLike {
  synth(): StackManifest;
  apiKey?: string;
  apiVersion?: string;
}

/**
 * Load the app file, synthesize its stack and find the Stripe API key (the stack's own, then
 * `STRIPE_SECRET_KEY`). Throws an error whose message is meant for the user.
 */
export function loadApp(appFile: string, env: NodeJS.ProcessEnv = process.env): LoadedApp {
  const appPath = path.resolve(process.cwd(), appFile);
  if (!fs.existsSync(appPath)) {
    throw new Error(`App file not found: ${appPath}`);
  }

  const appModule = require(appPath);
  const stack: StackLike | undefined = appModule.default || appModule.stack || appModule;
  if (!stack || typeof stack.synth !== 'function') {
    throw new Error('App must export a Stack instance with a synth() method');
  }

  const manifest = stack.synth();
  const apiKey = stack.apiKey || env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error(STRIPE_API_KEY_MISSING_ERROR);
  }
  return { manifest, apiKey, apiVersion: stack.apiVersion || manifest.apiVersion || DEFAULT_STRIPE_API_VERSION };
}
