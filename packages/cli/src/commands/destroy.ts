import { Command, Flags, ux } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { StripeDeployer } from '../engine/deployer';
import { StackManifest, STRIPE_API_KEY_MISSING_ERROR } from '@pricectl/core';

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
      description: 'Preview what would be destroyed without making any API calls',
      default: false,
    }),
  };

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

    if (flags['dry-run']) {
      this.log(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
      this.log('');
      this.log(`Stack: ${chalk.bold(manifest.stackId)}`);
      this.log('');
      this.log(chalk.bold(`Resources that would be destroyed (${manifest.resources.length}):`));
      for (const resource of manifest.resources) {
        this.log(chalk.red(`  - ${resource.path} [${resource.type}]`));
      }
      this.log('');
      this.log(chalk.bold('Summary:'));
      this.log(`  Total: ${chalk.red(manifest.resources.length)} resource(s) would be deleted/deactivated`);
      return;
    }

    try {

      this.log(chalk.bold.yellow(`⚠️  You are about to destroy stack: ${manifest.stackId}`));
      this.log('');
      this.log('The following resources will be deleted:');
      for (const resource of manifest.resources) {
        this.log(chalk.red(`  - ${resource.path} [${resource.type}]`));
      }
      this.log('');

      if (!flags.force) {
        if (!process.stdin.isTTY) {
          this.error('Cannot prompt for confirmation in a non-interactive environment. Use --force to skip confirmation.', { exit: 1 });
        }
        this.log(chalk.bold('This action cannot be undone!'));
        const confirmed = await ux.confirm('Do you want to proceed? [y/n]');
        if (!confirmed) {
          this.log('Destruction cancelled.');
          return;
        }
      }

      // Get Stripe API key
      const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
      if (!apiKey) {
        this.error(STRIPE_API_KEY_MISSING_ERROR, { exit: 1 });
      }

      this.log('Destroying resources...');
      this.log('');

      const deployer = new StripeDeployer(apiKey, manifest.apiVersion);
      const result = await deployer.destroy(manifest);

      // Display results
      this.log(chalk.bold.green('✓ Destruction completed'));
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
        this.error('Some resources could not be destroyed. See errors above.');
      }
    } catch (error: unknown) {
      this.error(`Destroy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
