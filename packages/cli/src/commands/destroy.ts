import { Command, Flags, ux } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { StripeDeployer } from '../engine/deployer';
import { StateManager } from '../engine/state';
import { destroyOutcome } from '../engine/outcome';
import { describeDestroyPlan } from '../engine/destroy-plan';
import { decideRemovalApproval } from '../engine/removal-approval';
import { StackManifest, STRIPE_API_KEY_MISSING_ERROR, DEFAULT_STRIPE_API_VERSION } from '@pricectl/core';

/** How a destroy run ended, decided inside the try block and reported outside it. */
type DestroyEnding = 'done' | 'failed' | 'refused';

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
    'state-file': Flags.string({
      description: 'Path to the state file directory',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview what would be destroyed, read from Stripe, without changing anything',
      default: false,
    }),
  };

  /** Destroy every resource of the stack after confirmation. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Destroy);

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
      this.error(STRIPE_API_KEY_MISSING_ERROR, { exit: 1 });
    }

    let ending: DestroyEnding = 'done';
    try {
      ending = await this.destroyStack(manifest, apiKey, flags);
    } catch (error: unknown) {
      this.error(`Destroy failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Outside the try block, so that the catch above does not wrap these messages
    if (ending === 'refused') {
      this.error('Cannot prompt for confirmation in a non-interactive environment. Use --force to skip confirmation.', { exit: 1 });
    }
    if (ending === 'failed') {
      this.error('Some resources could not be read or destroyed. See errors above.', { exit: 1 });
    }
  }

  /** Show what destroy would do, get approval, and destroy. Returns how the run ended. */
  private async destroyStack(
    manifest: StackManifest,
    apiKey: string,
    flags: { force: boolean; 'state-file'?: string; 'dry-run': boolean },
  ): Promise<DestroyEnding> {
    const stateManager = new StateManager(flags['state-file']);
    const apiVersion = manifest.apiVersion || DEFAULT_STRIPE_API_VERSION;
    const deployer = new StripeDeployer(apiKey, apiVersion, stateManager);

    // What destroy would do, read from Stripe, so already deleted or inactive resources are not listed
    const plan = await deployer.planDestroy(manifest);

    if (flags['dry-run']) {
      this.log(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
      this.log('');
      this.log(`Stack: ${chalk.bold(manifest.stackId)}`);
      this.log('');
      for (const line of describeDestroyPlan(plan)) this.log(line);
      this.log('');
      this.log(chalk.bold('Summary:'));
      this.log(`  Total: ${chalk.red(plan.resources.length)} resource(s) would be deleted/deactivated`);
      return plan.errors.length > 0 ? 'failed' : 'done';
    }

    if (plan.resources.length > 0) {
      this.log(chalk.bold.yellow(`⚠️  You are about to destroy stack: ${manifest.stackId}`));
      this.log('');
    }
    for (const line of describeDestroyPlan(plan)) this.log(line);
    this.log('');

    if (plan.errors.length > 0) return 'failed';

    const approval = decideRemovalApproval({
      removalCount: plan.resources.length,
      force: flags.force,
      interactive: Boolean(process.stdin.isTTY),
    });
    if (approval === 'none') {
      // Nothing changes in Stripe; this only drops state entries of resources that are already gone
      await deployer.destroy(manifest, plan);
      stateManager.save();
      return 'done';
    }
    if (approval === 'refuse') return 'refused';
    if (approval === 'confirm') {
      this.log(chalk.bold('This action cannot be undone!'));
      if (!(await ux.confirm('Do you want to proceed? [y/n]'))) {
        this.log('Destruction cancelled.');
        return 'done';
      }
    }

    this.log('Destroying resources...');
    this.log('');

    const result = await deployer.destroy(manifest, plan);

    // Save state after destroy (resources removed from state during destroy)
    stateManager.save();

    // Display results
    const outcome = destroyOutcome(result);
    this.log(outcome.failed ? chalk.bold.red(outcome.headline) : chalk.bold.green(outcome.headline));
    this.log('');

    if (result.destroyed.length > 0) {
      this.log(chalk.bold('Destroyed resources:'));
      for (const item of result.destroyed) {
        const status = item.status === 'deleted' ? chalk.red('deleted') : chalk.yellow('deactivated');
        this.log(`  ${status} ${item.id} [${item.type}]`);
      }
      this.log('');
    }

    if (result.errors.length > 0) {
      this.log(chalk.bold.red('Errors:'));
      for (const error of result.errors) {
        this.log(`  ${chalk.red('✗')} ${error.id}: ${error.error}`);
      }
      this.log('');
    }

    const deleted = result.destroyed.filter(d => d.status === 'deleted').length;
    const deactivated = result.destroyed.filter(d => d.status === 'deactivated').length;

    this.log(chalk.bold('Summary:'));
    this.log(`  Deleted: ${chalk.red(deleted)}`);
    this.log(`  Deactivated: ${chalk.yellow(deactivated)}`);
    if (result.errors.length > 0) {
      this.log(`  Errors: ${chalk.red(result.errors.length)}`);
    }
    this.log('');
    this.log(chalk.gray(`State saved to ${stateManager.getFilePath()}`));
    return outcome.failed ? 'failed' : 'done';
  }
}
