import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Deploy from '../commands/deploy';
import Destroy from '../commands/destroy';
import { FakeStripe } from './helpers/fake-stripe';
import { FIXTURE_APPS, runCommand } from './helpers/run-command';

let mockFakeStripe: FakeStripe;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockFakeStripe));

const APP = path.join(FIXTURE_APPS, 'widget-app.ts');

describe('destroy command', () => {
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

  const deployWidget = () => runCommand(Deploy, ['--app', APP, '--force']);
  const destroy = (flags: string[] = [], options = {}) => runCommand(Destroy, ['--app', APP, ...flags], options);

  describe('with a deployed product', () => {
    beforeEach(async () => {
      await deployWidget();
    });

    it('deletes the product and exits with code 0 when --force is given', async () => {
      const run = await destroy(['--force']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('removed CmdStack_Widget [Stripe::Product]');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('forgets the stack in pricectl.lock.json once everything was destroyed', async () => {
      const stacksInLock = () => Object.keys(JSON.parse(fs.readFileSync(path.join(projectDir, 'pricectl.lock.json'), 'utf-8')).stacks);
      expect(stacksInLock()).toEqual(['CmdStack']);

      await destroy(['--force']);

      expect(stacksInLock()).toEqual([]);
    });

    it('keeps the key in the lock as removing when the deletion fails, so the next destroy finishes', async () => {
      mockFakeStripe.failNext('products.del', { message: 'Stripe is unavailable', type: 'api_error' });

      await destroy(['--force']);

      const lock = JSON.parse(fs.readFileSync(path.join(projectDir, 'pricectl.lock.json'), 'utf-8'));
      expect(lock.stacks.CmdStack['Stripe::Product']).toEqual({ CmdStack_Widget: 'removing' });
    });

    it('lists what it would remove and changes nothing on --dry-run', async () => {
      const run = await destroy(['--dry-run']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Dry run');
      expect(run.stdout).toContain('- CmdStack_Widget [Stripe::Product]');
      expect(run.stdout).toContain('delete product CmdStack_Widget');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('refuses with exit code 1 and removes nothing without a terminal and without --force', async () => {
      const run = await destroy([], { interactive: false });

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('Use --force');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('destroys after the user confirms on an interactive terminal', async () => {
      const run = await destroy([], { interactive: true, confirm: true });

      expect(run.exitCode).toBe(0);
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('cancels with exit code 0 and removes nothing when the user declines', async () => {
      const run = await destroy([], { interactive: true, confirm: false });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Destruction cancelled.');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('exits with code 1 when Stripe rejects the deletion', async () => {
      mockFakeStripe.failNext('products.del', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await destroy(['--force']);

      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain('Stripe is unavailable');
      expect(run.error?.message).toContain('Some resources could not be destroyed');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('exits with code 1 and asks for nothing when the current state cannot be read from Stripe', async () => {
      mockFakeStripe.failNext('products.retrieve', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await destroy([], { interactive: true });

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('Stripe is unavailable');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('exits with code 1 on --dry-run when the current state cannot be read from Stripe', async () => {
      mockFakeStripe.failNext('products.retrieve', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await destroy(['--dry-run']);

      expect(run.exitCode).toBe(1);
    });
  });

  describe('with nothing deployed', () => {
    it('completes with exit code 0 without asking or needing --force', async () => {
      const run = await destroy([], { interactive: false });

      expect(run.exitCode).toBe(0);
    });
  });

  describe('before anything can be destroyed', () => {
    it('exits with code 1 when the app file does not exist', async () => {
      const run = await runCommand(Destroy, ['--app', path.join(projectDir, 'missing.ts'), '--force']);

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('App file not found');
    });

    it('exits with code 1 when the app does not export a stack', async () => {
      const run = await runCommand(Destroy, ['--app', path.join(FIXTURE_APPS, 'no-stack-app.ts'), '--force']);

      expect(run.exitCode).toBe(1);
      expect(run.error?.message).toContain('App must export a Stack instance');
    });
  });
});
