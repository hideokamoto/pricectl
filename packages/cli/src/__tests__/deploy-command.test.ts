import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Deploy from '../commands/deploy';
import Plan from '../commands/plan';
import { FakeStripe } from './helpers/fake-stripe';
import { FIXTURE_APPS, runCommand } from './helpers/run-command';

let mockFakeStripe: FakeStripe;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockFakeStripe));

const WIDGET_APP = path.join(FIXTURE_APPS, 'widget-app.ts');
const WIDGET_PRO_APP = path.join(FIXTURE_APPS, 'widget-pro-app.ts');
const EMPTY_APP = path.join(FIXTURE_APPS, 'empty-app.ts');

describe('plan and deploy commands', () => {
  let projectDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    mockFakeStripe = new FakeStripe();
    // pricectl.lock.json is kept in the current directory
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-cmd-'));
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const lockFile = () => path.join(projectDir, 'pricectl.lock.json');
  const deploy = (app: string, flags: string[] = [], options = {}) => runCommand(Deploy, ['--app', app, ...flags], options);
  const plan = (app: string, flags: string[] = []) => runCommand(Plan, ['--app', app, ...flags]);

  describe('plan', () => {
    it('shows what deploy would create, changes nothing in Stripe, and records the keys in the lock', async () => {
      const run = await plan(WIDGET_APP);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('+ CmdStack/Widget [Stripe::Product]');
      expect(run.stdout).toContain('create product CmdStack_Widget');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
      expect(JSON.parse(fs.readFileSync(lockFile(), 'utf-8')).stacks.CmdStack['Stripe::Product']).toEqual({ CmdStack_Widget: 'managed' });
    });

    it('says there is nothing to do once the stack is deployed', async () => {
      await deploy(WIDGET_APP, ['--force']);

      const run = await plan(WIDGET_APP);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Nothing to do');
    });

    it('with --frozen-lock fails while the lock is missing, without reading Stripe or writing the lock', async () => {
      const run = await plan(WIDGET_APP, ['--frozen-lock']);

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('pricectl.lock.json is out of date');
      expect(fs.existsSync(lockFile())).toBe(false);
    });

    it('exits with code 1 when Stripe cannot be read', async () => {
      await deploy(WIDGET_APP, ['--force']);
      mockFakeStripe.failNext('products.retrieve', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await plan(WIDGET_APP);

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('Plan failed: Stripe is unavailable');
    });
  });

  describe('deploy', () => {
    it('creates the product and completes', async () => {
      const run = await deploy(WIDGET_APP);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Deployment completed');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('--dry-run shows the plan like plan does and changes nothing in Stripe', async () => {
      const run = await deploy(WIDGET_APP, ['--dry-run']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('create product CmdStack_Widget');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('updates a changed product in place', async () => {
      await deploy(WIDGET_APP, ['--force']);

      const run = await deploy(WIDGET_PRO_APP, ['--force']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('update product CmdStack_Widget: name');
      expect(mockFakeStripe.productsFor('Widget')[0].name).toBe('Widget Pro');
    });

    it('refuses with exit code 1 and removes nothing without a terminal and without --force', async () => {
      await deploy(WIDGET_APP, ['--force']);

      const run = await deploy(EMPTY_APP, [], { interactive: false });

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('Use --force');
      expect(mockFakeStripe.productsFor('Widget')[0].active).toBe(true);
    });

    it('removes what left the definition after the user confirms', async () => {
      await deploy(WIDGET_APP, ['--force']);

      const run = await deploy(EMPTY_APP, [], { interactive: true, confirm: true });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('removed CmdStack_Widget [Stripe::Product]');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('cancels with exit code 0 and changes nothing when the user declines', async () => {
      await deploy(WIDGET_APP, ['--force']);

      const run = await deploy(EMPTY_APP, [], { interactive: true, confirm: false });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Deployment cancelled');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('exits with code 1 and reports the error when Stripe rejects a step', async () => {
      mockFakeStripe.failNext('products.create', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await deploy(WIDGET_APP);

      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain('Stripe is unavailable');
      expect(run.error?.message).toContain('Some resources could not be deployed');
    });

    it('with --frozen-lock fails while the lock is out of date and changes nothing', async () => {
      const run = await deploy(WIDGET_APP, ['--frozen-lock', '--force']);

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('pricectl.lock.json is out of date');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });
  });

  describe('before anything can be deployed', () => {
    it('exits with code 1 when the app file does not exist', async () => {
      const run = await deploy(path.join(projectDir, 'missing.ts'));

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('App file not found');
    });

    it('exits with code 1 when the app does not export a stack', async () => {
      const run = await deploy(path.join(FIXTURE_APPS, 'no-stack-app.ts'));

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('App must export a Stack instance');
    });
  });
});
