import { Command, Flags, ux } from '@oclif/core';
import chalk from 'chalk';
import Stripe from 'stripe';
import { loadApp } from '../app';
import { applyPlan } from '../engine/apply-plan';
import { describePlan } from '../engine/describe-plan';
import { describeResult } from '../engine/describe-result';
import { FileLockStore } from '../engine/lock-store';
import { destroyOutcome } from '../engine/outcome';
import { refusals, removals } from '../engine/plan';
import { decideRemovalApproval } from '../engine/removal-approval';
import { finishDestroy, planDestroy } from '../engine/stack-run';

export default class Destroy extends Command {
  static description = 'Destroy all resources in the stack';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip confirmation prompt',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview what would be destroyed, read from Stripe, without changing anything',
      default: false,
    }),
  };

  /** Remove every resource the lock claims for the stack, after confirmation. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Destroy);

    let app;
    try {
      app = loadApp(flags.app);
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : String(error), { exit: 1 });
    }

    let failed = false;
    try {
      const stripe = new Stripe(app.apiKey, { apiVersion: app.apiVersion as unknown as Stripe.LatestApiVersion });
      const store = new FileLockStore();
      const plan = await planDestroy(stripe, app.manifest, store);

      if (flags['dry-run']) {
        this.log(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
        this.log('');
      } else if (removals(plan).length > 0) {
        this.log(chalk.bold.yellow(`⚠️  You are about to destroy stack: ${app.manifest.stackId}`));
        this.log('');
      }
      for (const line of describePlan(plan)) this.log(line);
      if (flags['dry-run']) return;
      if (refusals(plan).length > 0) {
        this.error('Nothing was changed. Fix the problems above and try again.', { exit: 1 });
      }

      const approval = decideRemovalApproval({
        removalCount: removals(plan).length,
        force: flags.force,
        interactive: Boolean(process.stdin.isTTY),
      });
      if (approval === 'refuse') {
        this.error('Cannot prompt for confirmation in a non-interactive environment. Use --force to skip confirmation.', {
          exit: 1,
        });
      }
      if (approval === 'confirm') {
        this.log(chalk.bold('This action cannot be undone!'));
        if (!(await ux.confirm('Do you want to proceed? [y/n]'))) {
          this.log('Destruction cancelled.');
          return;
        }
      }

      const result = await applyPlan(stripe, plan);
      finishDestroy(store, app.manifest.stackId, result);

      const outcome = destroyOutcome(result);
      failed = outcome.failed;
      this.log(failed ? chalk.bold.red(outcome.headline) : chalk.bold.green(outcome.headline));
      this.log('');
      for (const line of describeResult(result)) this.log(line);
    } catch (error: unknown) {
      if (isOclifExit(error)) throw error;
      this.error(`Destroy failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (failed) {
      this.error('Some resources could not be destroyed. See errors above.', { exit: 1 });
    }
  }
}

/** Errors raised by this.error() and this.exit() must not be wrapped again. */
function isOclifExit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'oclif' in error;
}
