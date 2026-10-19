import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import { FileLockStore, syncLock } from '../engine/lock-store';
import { APP_FILE_HELP, LOCK_FILE_HELP } from '../help-text';

export default class Synth extends Command {
  static summary = 'Write the manifest of the stack definition to <output>/manifest.json, without contacting Stripe';

  static description = [
    'Runs the app file and writes the manifest it synthesizes. ' + LOCK_FILE_HELP,
    APP_FILE_HELP + ' synth needs it even though it does not contact Stripe.',
  ].join('\n\n');

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --app ./infra/main.ts',
    '<%= config.bin %> <%= command.id %> --output ./build',
    '<%= config.bin %> <%= command.id %> --frozen-lock',
  ];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output directory for the synthesized manifest',
      default: './pricectl.out',
    }),
    'frozen-lock': Flags.boolean({
      description: 'Fail instead of updating pricectl.lock.json when it is out of date (for CI)',
      default: false,
    }),
  };

  /** Synthesize the stack and write its manifest. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Synth);

    this.log('Synthesizing stack...');

    const appPath = path.resolve(process.cwd(), flags.app);

    // Pre-flight checks outside try block to preserve error messages
    if (!fs.existsSync(appPath)) {
      this.error(`App file not found: ${appPath}`, { exit: 1 });
    }

    // Dynamically import the user's stack definition (validation outside try block)
    const appModule = require(appPath);
    const stack = appModule.default || appModule.stack || appModule;

    if (!stack || typeof stack.synth !== 'function') {
      this.error('App must export a Stack instance with a synth() method', { exit: 1 });
    }

    const manifest = stack.synth();

    const lock = syncLock(manifest, new FileLockStore(), { frozen: flags['frozen-lock'] });
    if (!lock.ok) {
      this.error(lock.message, { exit: 1 });
    }
    if (lock.changed) {
      this.log('✓ Updated pricectl.lock.json (commit it to Git)');
    }

    try {
      // Ensure output directory exists
      const outputDir = path.resolve(process.cwd(), flags.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write manifest to file
      const manifestPath = path.join(outputDir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      this.log(`✓ Synthesized stack "${manifest.stackId}"`);
      this.log(`  Resources: ${manifest.resources.length}`);
      this.log(`  Output: ${manifestPath}`);
      this.log('');
      this.log('Resources:');
      for (const resource of manifest.resources) {
        this.log(`  - ${resource.path} [${resource.type}]`);
      }
    } catch (error: unknown) {
      this.error(`Failed to synthesize: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
