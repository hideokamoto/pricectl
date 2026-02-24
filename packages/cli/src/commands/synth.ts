import { Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';

export default class Synth extends Command {
  static description = 'Synthesize the stack definition into a deployable manifest';

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
    output: Flags.string({
      char: 'o',
      description: 'Output directory for the synthesized manifest',
      default: './pricectl.out',
    }),
  };

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
    } catch (error: any) {
      this.error(`Failed to synthesize: ${error.message}`);
    }
  }
}
