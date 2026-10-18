import { Command, Flags } from '@oclif/core';
import Stripe from 'stripe';
import { loadApp } from '../app';
import { describePlan } from '../engine/describe-plan';
import { FileLockStore } from '../engine/lock-store';
import { refusals } from '../engine/plan';
import { planDeploy } from '../engine/stack-run';
import { APP_FILE_HELP, LOCK_FILE_HELP } from '../help-text';

export default class Plan extends Command {
  static summary = 'Show what deploy would do to Stripe, without changing Stripe';

  static description = [
    'Reads Stripe and lists every step pricectl deploy would take. Exits with 1 when Stripe would refuse a ' +
      'step. ' + LOCK_FILE_HELP + ' An out-of-date lock then fails before Stripe is read.',
    APP_FILE_HELP,
  ].join('\n\n');

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --frozen-lock',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    'frozen-lock': Flags.boolean({
      description: 'Fail instead of updating pricectl.lock.json when it is out of date (for CI)',
      default: false,
    }),
  };

  /** Read Stripe by key, print the plan, and fail when a step would be refused. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Plan);

    let app;
    try {
      app = loadApp(flags.app);
    } catch (error: unknown) {
      this.error(error instanceof Error ? error.message : String(error), { exit: 1 });
    }

    try {
      const stripe = new Stripe(app.apiKey, { apiVersion: app.apiVersion as unknown as Stripe.LatestApiVersion });
      const run = await planDeploy(stripe, app.manifest, new FileLockStore(), { frozen: flags['frozen-lock'] });
      if (!run.ok) {
        this.error(run.message, { exit: 1 });
      }
      if (run.lockChanged) this.log('✓ Updated pricectl.lock.json (commit it to Git)');
      for (const line of describePlan(run.plan)) this.log(line);
      if (refusals(run.plan).length > 0) {
        this.exit(1);
      }
    } catch (error: unknown) {
      if (isOclifExit(error)) throw error;
      this.error(`Plan failed: ${error instanceof Error ? error.message : String(error)}`, { exit: 1 });
    }
  }
}

/** Errors raised by this.error() and this.exit() must not be wrapped again. */
function isOclifExit(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'oclif' in error;
}
