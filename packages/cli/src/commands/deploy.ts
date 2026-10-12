import { Command, Flags, ux } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { StripeDeployer } from '../engine/deployer';
import { StateManager } from '../engine/state';
import { deployOutcome } from '../engine/outcome';
import { findOrphans } from '../engine/orphans';
import { decideRemovalApproval } from '../engine/removal-approval';
import { describeDeployPlan } from '../engine/deploy-plan';
import { StackManifest, STRIPE_API_KEY_MISSING_ERROR, DEFAULT_STRIPE_API_VERSION } from '@pricectl/core';

export default class Deploy extends Command {
  static description = 'Deploy the stack to Stripe';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --force',
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
    'dry-run': Flags.boolean({
      description: 'Preview the API calls that would be made without actually deploying',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Remove resources that are no longer defined without asking for confirmation',
      default: false,
    }),
  };

  /** Deploy the stack, asking before removing resources that are no longer defined. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Deploy);

    this.log('Deploying stack to Stripe...');
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

    if (flags['dry-run']) {
      const removals = findOrphans(manifest, new StateManager(flags['state-file']));
      for (const line of describeDeployPlan(manifest, removals)) {
        this.log(line);
      }
      return;
    }

    // Get Stripe API key
    const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      this.error(STRIPE_API_KEY_MISSING_ERROR, { exit: 1 });
    }

    const stateManager = new StateManager(flags['state-file']);

    // Removing resources is destructive, so it needs approval before anything is changed
    const removals = findOrphans(manifest, stateManager);
    const approval = decideRemovalApproval({
      removalCount: removals.length,
      force: flags.force,
      interactive: Boolean(process.stdin.isTTY),
    });
    if (approval === 'confirm' || approval === 'refuse') {
      this.log(chalk.bold.yellow('The following resources are no longer defined and will be removed from Stripe:'));
      for (const resource of removals) {
        this.log(chalk.red(`  - ${resource.path} [${resource.type}]`));
      }
      this.log('');
    }
    if (approval === 'refuse') {
      this.error('Cannot ask for confirmation in a non-interactive environment. Use --force to remove these resources.', {
        exit: 1,
      });
    }
    if (approval === 'confirm' && !(await ux.confirm('Remove these resources? [y/n]'))) {
      this.log('Deployment cancelled. No changes were made.');
      return;
    }

    let failed = false;
    try {
      // Deploy using the deployer
      const apiVersion = manifest.apiVersion || DEFAULT_STRIPE_API_VERSION;
      const deployer = new StripeDeployer(apiKey, apiVersion, stateManager);
      const result = await deployer.deploy(manifest);

      // Display results
      const outcome = deployOutcome(result);
      failed = outcome.failed;
      this.log(failed ? chalk.bold.red(outcome.headline) : chalk.bold.green(outcome.headline));
      this.log('');

      if (result.deployed.length > 0) {
        this.log(chalk.bold('Deployed resources:'));
        for (const item of result.deployed) {
          const status = item.status === 'created' ? chalk.green('created') :
                        item.status === 'updated' ? chalk.yellow('updated') :
                        chalk.gray('unchanged');
          this.log(`  ${status} ${item.id} [${item.type}] → ${item.physicalId}`);
        }
        this.log('');
      }

      if (result.removed.length > 0) {
        this.log(chalk.bold('Removed resources (no longer defined):'));
        for (const item of result.removed) {
          this.log(`  ${chalk.red(item.status)} ${item.id} [${item.type}]`);
        }
        this.log('');
      }

      if (result.removalSkipped) {
        this.log(chalk.yellow('Resources that are no longer defined were not removed because of the errors below.'));
        this.log('');
      }

      if (result.errors.length > 0) {
        this.log(chalk.bold.red('Errors:'));
        for (const error of result.errors) {
          this.log(`  ${chalk.red('✗')} ${error.id}: ${error.error}`);
        }
        this.log('');
      }

      const created = result.deployed.filter(d => d.status === 'created').length;
      const updated = result.deployed.filter(d => d.status === 'updated').length;
      const unchanged = result.deployed.filter(d => d.status === 'unchanged').length;

      this.log(chalk.bold('Summary:'));
      this.log(`  Created: ${chalk.green(created)}`);
      this.log(`  Updated: ${chalk.yellow(updated)}`);
      this.log(`  Unchanged: ${chalk.gray(unchanged)}`);
      if (result.removed.length > 0) {
        this.log(`  Removed: ${chalk.red(result.removed.length)}`);
      }
      if (result.errors.length > 0) {
        this.log(`  Errors: ${chalk.red(result.errors.length)}`);
      }
    } catch (error: unknown) {
      this.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Always save state, even if there were errors during deployment
      try {
        stateManager.save();
        this.log('');
        this.log(chalk.gray(`State saved to ${stateManager.getFilePath()}`));
      } catch (saveError: unknown) {
        this.log('');
        this.log(chalk.yellow(`Warning: Failed to save state: ${saveError instanceof Error ? saveError.message : String(saveError)}`));
      }
    }

    if (failed) {
      this.error('Some resources could not be deployed. See errors above.', { exit: 1 });
    }
  }
}
