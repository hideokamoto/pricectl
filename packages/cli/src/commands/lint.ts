import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import type * as TypeScript from 'typescript';
import { formatDiagnostic, typeCheckApp } from '../type-check';

export default class Lint extends Command {
  static description =
    'Type-check the stack definition (like tsc --noEmit), using the project tsconfig.json when there is one';

  static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --app ./infra/main.ts'];

  static flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app file that defines your stack',
      default: './pricectl.ts',
    }),
  };

  /** Type-check the definition, print every diagnostic, and fail when there is a type error. */
  async run(): Promise<void> {
    const { flags } = await this.parse(Lint);
    const cwd = process.cwd();
    const appPath = path.resolve(cwd, flags.app);
    if (!fs.existsSync(appPath)) {
      this.error(`App file not found: ${appPath}`, { exit: 1 });
    }

    // Loaded here so that the other commands do not pay for loading the compiler.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts: typeof TypeScript = require('typescript');
    const appName = path.relative(cwd, appPath);
    const { configFile, diagnostics } = typeCheckApp(ts, appPath);
    this.log(
      configFile
        ? `Type-checking ${appName} with ${path.relative(cwd, configFile)}`
        : `Type-checking ${appName} with pricectl's default compiler options (no tsconfig.json found)`,
    );
    for (const diagnostic of diagnostics) {
      this.log(formatDiagnostic(ts, diagnostic, cwd));
    }

    const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length;
    if (errors > 0) {
      this.error(`Found ${errors} type ${errors === 1 ? 'error' : 'errors'} in ${appName}`, { exit: 1 });
    }
    this.log(`✓ No type errors in ${appName}`);
  }
}
