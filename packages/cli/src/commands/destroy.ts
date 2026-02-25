import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { StripeDeployer } from '../engine/deployer';
import { StateManager } from '../engine/state';
import { StackManifest } from '@pricectl/core';

export default class Destroy extends Command {
  static description = 'Destroy all resources in the stack';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --force',
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

    try {

      this.log(chalk.bold.yellow(`⚠️  You are about to destroy stack: ${manifest.stackId}`));
      this.log('');
      this.log('The following resources will be deleted:');
      for (const resource of manifest.resources) {
        this.log(chalk.red(`  - ${resource.path} [${resource.type}]`));
      }
      this.log('');

      if (!flags.force) {
        this.log(chalk.bold('This action cannot be undone!'));
        this.log('To proceed, run with --force flag');
        return;
      }

      // Get Stripe API key
      const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
      if (!apiKey) {
        this.error('Stripe API key not found. Set STRIPE_SECRET_KEY environment variable.');
      }

      this.log('Destroying resources...');
      this.log('');

      // Load state
      const stateManager = new StateManager(flags['state-file']);

      const deployer = new StripeDeployer(apiKey, stateManager);
      const result = await deployer.destroy(manifest);

      // Save state after destroy (resources removed from state during destroy)
      stateManager.save();

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

      this.log('');
      this.log(chalk.gray(`State saved to ${stateManager.getFilePath()}`));
    } catch (error: any) {
      this.error(`Destroy failed: ${error.message}`);
    }
  }
}
