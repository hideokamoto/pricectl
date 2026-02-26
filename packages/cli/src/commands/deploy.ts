import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { StripeDeployer } from '../engine/deployer';
import { StackManifest, STRIPE_API_KEY_MISSING_ERROR } from '@pricectl/core';

export default class Deploy extends Command {
  static description = 'Deploy the stack to Stripe';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview the API calls that would be made without actually deploying',
      default: false,
    }),
  };

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
      this.log(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
      this.log('');
      this.log(`Stack: ${chalk.bold(manifest.stackId)}`);
      if (manifest.description) this.log(`Description: ${manifest.description}`);
      this.log('');
      this.log(chalk.bold(`Resources to deploy (${manifest.resources.length}):`));
      for (const resource of manifest.resources) {
        this.log(chalk.green(`  + ${resource.path} [${resource.type}]`));
        this.log('    Properties:');
        for (const line of JSON.stringify(resource.properties, null, 2).split('\n')) {
          this.log(`    ${line}`);
        }
      }
      this.log('');
      this.log(chalk.bold('Summary:'));
      this.log(`  Total: ${chalk.green(manifest.resources.length)} resource(s) would be created/updated`);
      return;
    }

    // Get Stripe API key
    const apiKey = stack.apiKey || process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      this.error(STRIPE_API_KEY_MISSING_ERROR, { exit: 1 });
    }

    try {
      // Deploy using the deployer
      const deployer = new StripeDeployer(apiKey, manifest.apiVersion);
      const result = await deployer.deploy(manifest);

      // Display results
      this.log(chalk.bold.green('✓ Deployment completed'));
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
      if (result.errors.length > 0) {
        this.log(`  Errors: ${chalk.red(result.errors.length)}`);
      }
    } catch (error: unknown) {
      this.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
