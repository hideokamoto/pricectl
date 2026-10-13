import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Deploy from '../commands/deploy';
import Diff from '../commands/diff';
import { FakeStripe } from './helpers/fake-stripe';
import { FIXTURE_APPS, runCommand } from './helpers/run-command';

let mockFakeStripe: FakeStripe;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockFakeStripe));

const WIDGET_APP = path.join(FIXTURE_APPS, 'widget-app.ts');
const WIDGET_PRO_APP = path.join(FIXTURE_APPS, 'widget-pro-app.ts');
const EMPTY_APP = path.join(FIXTURE_APPS, 'empty-app.ts');

describe('diff command', () => {
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

  const deployWidget = () => runCommand(Deploy, ['--app', WIDGET_APP, '--force']);
  const diff = (app: string) => runCommand(Diff, ['--app', app]);

  it('shows a resource that is not in Stripe yet as to be created', async () => {
    const run = await diff(WIDGET_APP);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('[+] CmdStack/Widget [Stripe::Product]');
  });

  it('reports no changes for a deployed stack that was not edited', async () => {
    await deployWidget();

    const run = await diff(WIDGET_APP);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('No changes detected');
  });

  it('shows the changed property of a deployed resource', async () => {
    await deployWidget();

    const run = await diff(WIDGET_PRO_APP);

    expect(run.stdout).toContain('[~] CmdStack/Widget [Stripe::Product]');
    expect(run.stdout).toContain('Widget Pro');
  });

  it('shows a deployed resource that is no longer defined as to be removed', async () => {
    await deployWidget();

    const run = await diff(EMPTY_APP);

    expect(run.stdout).toContain('[-] CmdStack_Widget [Stripe::Product]');
  });

  it('changes nothing in Stripe', async () => {
    await deployWidget();

    await diff(EMPTY_APP);

    expect(mockFakeStripe.productsFor('Widget')).toHaveLength(1);
  });

  it('fails with a non-zero exit code when Stripe cannot be read', async () => {
    await deployWidget();
    mockFakeStripe.failNext('products.retrieve', { message: 'Stripe is unavailable', type: 'api_error' });

    const run = await diff(WIDGET_APP);

    expect(run.exitCode).not.toBe(0);
    expect(run.error?.message).toContain('Diff failed: Stripe is unavailable');
  });

  it('exits with code 1 when the app file does not exist', async () => {
    const run = await diff(path.join(projectDir, 'missing.ts'));

    expect(run.exitCode).toBe(1);
    expect(run.error?.message).toContain('App file not found');
  });
});
