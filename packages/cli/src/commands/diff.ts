import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import Stripe from 'stripe';
import { StackManifest, DEFAULT_STRIPE_API_VERSION } from '@pricectl/core';
import { fetchCurrentResource } from '../engine/stripe-utils';
import { diffResource, resolveReferencesFromState } from '../engine/diff';
import { findOrphans } from '../engine/orphans';
import { StateManager } from '../engine/state';

export default class Diff extends Command {
  static description = 'Compare the deployed stack with the local definition';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    'state-file': Flags.string({
      description: 'Path to the state file directory',
    }),
  };

  /** Compare each resource with Stripe and print the differences. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Diff);

    this.log('Computing diff...');
    this.log('');

    const appPath = path.resolve(process.cwd(), flags.app);

    // Pre-flight checks outside try block to preserve error messages
    if (!fs.existsSync(appPath)) {
      this.error(`App file not found: ${appPath}`, { exit: 1 });
    }

    // Load and synthesize the stack (validation outside try block)
    const appModule = require(appPath);
    const stack = appModule.default || appModule.stack || appModule;

    if (!stack || typeof stack.synth !== 'function') {
      this.error('App must export a Stack instance with a synth() method', { exit: 1 });
    }

    const manifest: StackManifest = stack.synth();

    // Get Stripe API key
    const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      this.error('Stripe API key not found. Set STRIPE_SECRET_KEY environment variable.', { exit: 1 });
    }

    try {
      const apiVersion = stack.apiVersion || manifest.apiVersion || DEFAULT_STRIPE_API_VERSION;
      const stripe = new Stripe(apiKey, { apiVersion: apiVersion as unknown as Stripe.LatestApiVersion });
      const stateManager = new StateManager(flags['state-file']);

      // Fetch current state from Stripe
      this.log(chalk.bold(`Stack: ${manifest.stackId}`));
      this.log('');

      let hasChanges = false;

      for (const resource of manifest.resources) {
        const current = await fetchCurrentResource(stripe, resource, stateManager, manifest.stackId);

        if (!current) {
          this.log(chalk.green(`[+] ${resource.path} [${resource.type}]`));
          this.log(chalk.gray('    Will be created'));
          this.log('');
          hasChanges = true;
          continue;
        }

        // Resolve logical IDs in desired properties for accurate comparison
        const desiredProperties = resolveReferencesFromState(resource, manifest.stackId, stateManager);

        const diff = diffResource(resource.type, desiredProperties, current);

        if (diff.changed) {
          this.log(chalk.yellow(`[~] ${resource.path} [${resource.type}]`));
          const patch = createTwoFilesPatch(
            'current',
            'desired',
            diff.current,
            diff.desired,
            '',
            ''
          );
          this.log(this.colorDiff(patch));
          this.log('');
          hasChanges = true;
        }
      }

      for (const orphan of findOrphans(manifest, stateManager)) {
        this.log(chalk.red(`[-] ${orphan.path} [${orphan.type}]`));
        this.log(chalk.gray('    No longer defined; will be removed on deploy'));
        this.log('');
        hasChanges = true;
      }

      if (!hasChanges) {
        this.log(chalk.gray('No changes detected'));
      }
    } catch (error: unknown) {
      this.error(`Diff failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Color the added, removed and hunk lines of a unified diff. */
  private colorDiff(patch: string): string {
    return patch.split('\n').map(line => {
      if (line.startsWith('+')) return chalk.green(line);
      if (line.startsWith('-')) return chalk.red(line);
      if (line.startsWith('@@')) return chalk.cyan(line);
      return chalk.gray(line);
    }).join('\n');
  }
}
