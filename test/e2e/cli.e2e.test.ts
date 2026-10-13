import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const apiKey = process.env.STRIPE_SECRET_KEY;
const describeWithStripe = apiKey ? describe : describe.skip;

const REPO = path.resolve(__dirname, '../..');
const CLI = path.join(REPO, 'packages/cli/bin/run');

/** The commands as a user runs them, against Stripe test mode. Needs `pnpm build` first. */
describeWithStripe('pricectl commands against Stripe test mode', () => {
  if (apiKey && !apiKey.includes('_test_')) {
    throw new Error('The end-to-end tests change real objects: use a Stripe test-mode key.');
  }

  const stackId = `E2eCli${Date.now()}`;
  let dir: string;

  const writeApp = (unitAmount: number) =>
    fs.writeFileSync(
      path.join(dir, 'pricectl.js'),
      `const { Stack } = require(${JSON.stringify(path.join(REPO, 'packages/core'))});
const { Product, Price } = require(${JSON.stringify(path.join(REPO, 'packages/constructs'))});
const stack = new Stack(undefined, ${JSON.stringify(stackId)});
const product = new Product(stack, 'Pro', { name: 'pricectl e2e cli' });
new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: ${unitAmount}, recurring: { interval: 'month' }, isDefault: true });
module.exports = stack;
`,
    );

  const run = (...args: string[]) => {
    const result = spawnSync('node', [CLI, ...args, '--app', './pricectl.js'], { cwd: dir, env: { ...process.env, STRIPE_SECRET_KEY: apiKey }, encoding: 'utf-8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-e2e-cli-'));
    writeApp(1000);
  });

  afterAll(() => {
    run('destroy', '--force');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plan --frozen-lock fails while pricectl.lock.json does not exist', () => {
    const result = run('plan', '--frozen-lock');

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('pricectl.lock.json is out of date');
  });

  it('plan writes the lock and shows what deploy would create', () => {
    const result = run('plan');

    expect(result.status).toBe(0);
    expect(result.output).toContain('Updated pricectl.lock.json');
    expect(result.output).toContain(`+ ${stackId}/Monthly [Stripe::Price]`);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'pricectl.lock.json'), 'utf-8')).stacks[stackId]['Stripe::Price']).toEqual({
      [`${stackId}_Monthly`]: 'managed',
    });
  });

  it('deploy applies the plan and plan then has nothing to do', () => {
    const deployed = run('deploy', '--frozen-lock', '--force');
    const again = run('plan', '--frozen-lock');

    expect(deployed.status).toBe(0);
    expect(deployed.output).toContain('Deployment completed');
    expect(again.status).toBe(0);
    expect(again.output).toContain('Nothing to do');
  });

  it('deploy replaces the default price when the amount changes', () => {
    writeApp(2000);

    const result = run('deploy', '--force');

    expect(result.status).toBe(0);
    expect(result.output).toContain('make the new price the default price');
    expect(result.output).toContain('Deployment completed');
  });

  it('destroy removes everything and forgets the stack in the lock', () => {
    const result = run('destroy', '--force');

    expect(result.status).toBe(0);
    expect(result.output).toContain('Destruction completed');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'pricectl.lock.json'), 'utf-8')).stacks).toEqual({});
  });
});
