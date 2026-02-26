import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import Stripe from 'stripe';
import { StackManifest, ResourceManifest } from '@pricectl/core';
import { fetchCurrentResource, normalizeResource } from '../engine/stripe-utils';
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
      const apiVersion = stack.apiVersion || manifest.apiVersion || '2024-12-18.acacia';
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

        // Compare properties
        const desired = JSON.stringify(resource.properties, null, 2);
        const existing = JSON.stringify(normalizeResource(current, resource.type), null, 2);

        if (desired !== existing) {
          this.log(chalk.yellow(`[~] ${resource.path} [${resource.type}]`));
          const patch = createTwoFilesPatch(
            'current',
            'desired',
            existing,
            desired,
            '',
            ''
          );
          this.log(this.colorDiff(patch));
          this.log('');
          hasChanges = true;
        }
      }

      if (!hasChanges) {
        this.log(chalk.gray('No changes detected'));
      }
    } catch (error: unknown) {
      this.error(`Diff failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private colorDiff(patch: string): string {
    return patch.split('\n').map(line => {
      if (line.startsWith('+')) return chalk.green(line);
      if (line.startsWith('-')) return chalk.red(line);
      if (line.startsWith('@@')) return chalk.cyan(line);
      return chalk.gray(line);
    }).join('\n');
  }
}
