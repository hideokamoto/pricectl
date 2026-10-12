import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Deploy from '../commands/deploy';
import { FakeStripe } from './helpers/fake-stripe';
import { FIXTURE_APPS, runCommand } from './helpers/run-command';

let mockFakeStripe: FakeStripe;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockFakeStripe));

const WIDGET_APP = path.join(FIXTURE_APPS, 'widget-app.ts');
const EMPTY_APP = path.join(FIXTURE_APPS, 'empty-app.ts');

describe('deploy command', () => {
  let stateDir: string;

  beforeEach(() => {
    mockFakeStripe = new FakeStripe();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-cmd-'));
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  const deploy = (app: string, flags: string[] = [], options = {}) =>
    runCommand(Deploy, ['--app', app, '--state-file', stateDir, ...flags], options);

  describe('creating resources', () => {
    it('creates the product in Stripe and exits with code 0', async () => {
      const run = await deploy(WIDGET_APP);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('created Widget [Stripe::Product]');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('saves the deployed resource to the state file', async () => {
      await deploy(WIDGET_APP);

      const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pricectl.state.json'), 'utf-8'));
      expect(Object.keys(state.stacks.CmdStack.resources)).toEqual(['Widget']);
    });

    it('reports a second deploy of the same app as unchanged', async () => {
      await deploy(WIDGET_APP);

      const run = await deploy(WIDGET_APP);

      expect(run.stdout).toContain('unchanged Widget [Stripe::Product]');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('exits with code 1, still saves the state, when Stripe rejects a resource', async () => {
      mockFakeStripe.failNext('products.create', { message: 'Stripe is unavailable', type: 'api_error' });

      const run = await deploy(WIDGET_APP);

      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain('Stripe is unavailable');
      expect(run.stdout).toContain('State saved to');
      expect(run.error?.message).toContain('Some resources could not be deployed');
    });
  });

  describe('--dry-run', () => {
    it('prints the plan and creates nothing in Stripe', async () => {
      const run = await deploy(WIDGET_APP, ['--dry-run']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Widget');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });
  });

  describe('resources that are no longer defined', () => {
    beforeEach(async () => {
      await deploy(WIDGET_APP);
    });

    it('refuses with exit code 1 and removes nothing without a terminal and without --force', async () => {
      const run = await deploy(EMPTY_APP, [], { interactive: false });

      expect(run.exitCode).toBe(1);
      expect(run.stdout).toContain('CmdStack/Widget');
      expect(run.error?.message).toContain('Use --force');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });

    it('removes them when --force is given', async () => {
      const run = await deploy(EMPTY_APP, ['--force']);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Removed resources (no longer defined):');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('removes them after the user confirms on an interactive terminal', async () => {
      const run = await deploy(EMPTY_APP, [], { interactive: true, confirm: true });

      expect(run.exitCode).toBe(0);
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(0);
    });

    it('cancels with exit code 0 and changes nothing when the user declines', async () => {
      const run = await deploy(EMPTY_APP, [], { interactive: true, confirm: false });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('Deployment cancelled. No changes were made.');
      expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
    });
  });

  describe('before anything can be deployed', () => {
    it('exits with code 1 when the app file does not exist', async () => {
      const run = await deploy(path.join(stateDir, 'missing.ts'));

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
