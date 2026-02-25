import { Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

// Import CLI package.json to get current version
const cliPackageJson = require('../../package.json');

export default class Init extends Command {
  static description = 'Initialize a new pricectl project';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --typescript',
  ];

  static flags = {
    typescript: Flags.boolean({
      char: 't',
      description: 'Use TypeScript (default)',
      default: true,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Init);

    this.log('Initializing pricectl project...');
    this.log('');

    const cwd = process.cwd();

    // Create package.json if it doesn't exist
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      // Use the CLI's version for all @pricectl/* packages to ensure compatibility
      const pricectlVersion = `^${cliPackageJson.version}`;

      const packageJson = {
        name: path.basename(cwd),
        version: '0.1.0',
        private: true,
        scripts: {
          build: 'tsc',
          synth: 'pricectl synth',
          deploy: 'pricectl deploy',
          diff: 'pricectl diff',
        },
        dependencies: {
          '@pricectl/core': pricectlVersion,
          '@pricectl/constructs': pricectlVersion,
        },
        devDependencies: {
          '@pricectl/cli': pricectlVersion,
          '@types/node': '^20.10.0',
          typescript: '^5.3.3',
        },
      };

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      this.log(chalk.green('✓ Created package.json'));
    }

    // Create tsconfig.json
    const tsconfigPath = path.join(cwd, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath) || flags.force) {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          moduleResolution: 'node',
        },
        include: ['*.ts'],
      };

      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      this.log(chalk.green('✓ Created tsconfig.json'));
    }

    // Create example pricectl.ts
    const pricectlTsPath = path.join(cwd, 'pricectl.ts');
    if (!fs.existsSync(pricectlTsPath) || flags.force) {
      const example = `import { Stack } from '@pricectl/core';
import { Product, Price, Coupon } from '@pricectl/constructs';

// Create a new stack
const stack = new Stack(undefined, 'MyStack', {
  description: 'My Stripe Infrastructure',
});

// Define a product
const product = new Product(stack, 'PremiumPlan', {
  name: 'Premium Plan',
  description: 'Access to all premium features',
  active: true,
});

// Define a monthly price
new Price(stack, 'MonthlyPrice', {
  product,
  currency: 'usd',
  unitAmount: 1999, // $19.99
  recurring: {
    interval: 'month',
  },
  nickname: 'Monthly Premium',
});

// Define a yearly price with discount
new Price(stack, 'YearlyPrice', {
  product,
  currency: 'usd',
  unitAmount: 19999, // $199.99 (save ~17%)
  recurring: {
    interval: 'year',
  },
  nickname: 'Yearly Premium',
});

// Create a coupon
new Coupon(stack, 'WelcomeCoupon', {
  name: 'Welcome Discount',
  percentOff: 20,
  duration: 'once',
});

export default stack;
`;

      fs.writeFileSync(pricectlTsPath, example);
      this.log(chalk.green('✓ Created pricectl.ts'));
    }

    // Create .env.example
    const envExamplePath = path.join(cwd, '.env.example');
    if (!fs.existsSync(envExamplePath) || flags.force) {
      fs.writeFileSync(envExamplePath, 'STRIPE_SECRET_KEY=sk_test_...\n');
      this.log(chalk.green('✓ Created .env.example'));
    }

    // Create .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    const gitignoreContent = `
.env
pricectl.out/
pricectl.state.json
node_modules/
dist/
*.js
*.d.ts
`.trim();

    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, gitignoreContent + '\n');
      this.log(chalk.green('✓ Created .gitignore'));
    } else if (flags.force) {
      const existing = fs.readFileSync(gitignorePath, 'utf-8');
      if (!existing.includes('pricectl.out/')) {
        fs.appendFileSync(gitignorePath, '\n' + gitignoreContent + '\n');
        this.log(chalk.green('✓ Updated .gitignore'));
      }
    }

    this.log('');
    this.log(chalk.bold.green('✓ Project initialized successfully!'));
    this.log('');
    this.log('Next steps:');
    this.log('  1. Set your Stripe secret key:');
    this.log(chalk.cyan('     export STRIPE_SECRET_KEY=sk_test_...'));
    this.log('  2. Install dependencies:');
    this.log(chalk.cyan('     npm install'));
    this.log('  3. Build your stack definition:');
    this.log(chalk.cyan('     npm run build'));
    this.log('  4. Deploy to Stripe:');
    this.log(chalk.cyan('     npm run deploy'));
  }
}
