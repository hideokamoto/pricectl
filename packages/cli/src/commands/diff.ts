import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import Stripe from 'stripe';
import { loadApp } from '../app';
import { composePlan } from '../engine/build-plan';
import { currentResource } from '../engine/current';
import { diffResource } from '../engine/diff';
import { nextLock, parseLock } from '../engine/lock';
import { FileLockStore } from '../engine/lock-store';
import { removals } from '../engine/plan';
import { readObservations } from '../engine/read-stripe';
import { indexResources, resolveReferences } from '../engine/refs';

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
  };

  /** Compare each resource with Stripe and print the differences. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Diff);

    this.log('Computing diff...');
    this.log('');

    let app;
    try {
      app = loadApp(flags.app);
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : String(error), { exit: 1 });
    }
    const { manifest } = app;

    try {
      const stripe = new Stripe(app.apiKey, { apiVersion: app.apiVersion as unknown as Stripe.LatestApiVersion });
      // The lock the definition implies; diff does not write it
      const lock = nextLock(manifest, parseLock(new FileLockStore().read()));
      const observations = await readObservations(stripe, manifest, lock);
      const resources = indexResources(manifest);

      this.log(chalk.bold(`Stack: ${manifest.stackId}`));
      this.log('');

      let hasChanges = false;

      for (const resource of manifest.resources) {
        const current = currentResource(resource, observations);

        if (!current) {
          this.log(chalk.green(`[+] ${resource.path} [${resource.type}]`));
          this.log(chalk.gray('    Will be created'));
          this.log('');
          hasChanges = true;
          continue;
        }

        const diff = diffResource(resource.type, resolveReferences(resource, resources, observations), current);

        if (diff.changed) {
          this.log(chalk.yellow(`[~] ${resource.path} [${resource.type}]`));
          const patch = createTwoFilesPatch('current', 'desired', diff.current, diff.desired, '', '');
          this.log(this.colorDiff(patch));
          this.log('');
          hasChanges = true;
        }
      }

      for (const removed of removals(composePlan(manifest, lock, observations))) {
        this.log(chalk.red(`[-] ${removed.path} [${removed.type}]`));
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
