import { Command, Flags, ux } from '@oclif/core';
import chalk from 'chalk';
import Stripe from 'stripe';
import { loadApp } from '../app';
import { applyPlan } from '../engine/apply-plan';
import { describePlan } from '../engine/describe-plan';
import { describeResult } from '../engine/describe-result';
import { FileLockStore } from '../engine/lock-store';
import { deployOutcome } from '../engine/outcome';
import { refusals, removals } from '../engine/plan';
import { decideRemovalApproval } from '../engine/removal-approval';
import { planDeploy } from '../engine/stack-run';

export default class Deploy extends Command {
  static description = 'Deploy the stack to Stripe';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
    '<%= config.bin %> <%= command.id %> --frozen-lock --force',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be created, updated or removed, read from Stripe, without changing anything (same as pricectl plan)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Remove resources that are no longer defined without asking for confirmation',
      default: false,
    }),
    'frozen-lock': Flags.boolean({
      description: 'Fail instead of updating pricectl.lock.json when it is out of date (for CI)',
      default: false,
    }),
  };

  /** Plan the deploy, show the plan, and apply it after approval of any removal. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Deploy);

    let app;
    try {
      app = loadApp(flags.app);
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : String(error), { exit: 1 });
    }

    if (!flags['dry-run']) {
      this.log('Planning the deploy...');
      this.log('');
    }

    let failed = false;
    try {
      const stripe = new Stripe(app.apiKey, { apiVersion: app.apiVersion as unknown as Stripe.LatestApiVersion });
      const run = await planDeploy(stripe, app.manifest, new FileLockStore(), { frozen: flags['frozen-lock'] });
      if (!run.ok) {
        this.error(run.message, { exit: 1 });
      }
      if (run.lockChanged) this.log('✓ Updated pricectl.lock.json (commit it to Git)');

      const { plan } = run;
      for (const line of describePlan(plan)) this.log(line);
      if (refusals(plan).length > 0) {
        this.error('Nothing was changed. Fix the problems above and deploy again.', { exit: 1 });
      }
      if (flags['dry-run']) return;

      const approval = decideRemovalApproval({
        removalCount: removals(plan).length,
        force: flags.force,
        interactive: Boolean(process.stdin.isTTY),
      });
      if (approval === 'refuse') {
        this.error('Cannot ask for confirmation in a non-interactive environment. Use --force to remove these resources.', {
          exit: 1,
        });
      }
      if (approval === 'confirm' && !(await ux.confirm('Remove the resources above from Stripe? [y/n]'))) {
        this.log('Deployment cancelled. No changes were made.');
        return;
      }

      const result = await applyPlan(stripe, plan);
      const outcome = deployOutcome(result);
      failed = outcome.failed;
      this.log(failed ? chalk.bold.red(outcome.headline) : chalk.bold.green(outcome.headline));
      this.log('');
      for (const line of describeResult(result)) this.log(line);
    } catch (error: unknown) {
      if (isOclifExit(error)) throw error;
      this.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`, { exit: 1 });
    }

    if (failed) {
      this.error('Some resources could not be deployed. See errors above.', { exit: 1 });
    }
  }
}

/** Errors raised by this.error() and this.exit() must not be wrapped again. */
function isOclifExit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'oclif' in error;
}
