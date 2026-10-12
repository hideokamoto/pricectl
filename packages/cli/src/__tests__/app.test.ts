import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadApp } from '../app';

describe('loadApp', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-app-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeApp = (source: string) => {
    const file = path.join(dir, 'app.js');
    fs.writeFileSync(file, source);
    return file;
  };

  it('synthesizes the stack the app exports and returns what is needed to reach Stripe', () => {
    const file = writeApp(
      `module.exports = { apiKey: 'sk_test_x', apiVersion: '2025-03-31.basil', synth: () => ({ stackId: 'Shop', tags: {}, resources: [] }) };`,
    );

    const app = loadApp(file, {});

    expect(app).toEqual({
      manifest: { stackId: 'Shop', tags: {}, resources: [] },
      apiKey: 'sk_test_x',
      apiVersion: '2025-03-31.basil',
    });
  });

  it('accepts a default export and falls back to STRIPE_SECRET_KEY and the default API version', () => {
    const file = writeApp(`exports.default = { synth: () => ({ stackId: 'Shop', tags: {}, resources: [] }) };`);

    const app = loadApp(file, { STRIPE_SECRET_KEY: 'sk_test_env' });

    expect(app.apiKey).toBe('sk_test_env');
    expect(app.apiVersion).toBe('2026-09-30.endive');
  });

  it('says so when the app file does not exist', () => {
    expect(() => loadApp(path.join(dir, 'missing.js'), {})).toThrow(`App file not found: ${path.join(dir, 'missing.js')}`);
  });

  it('says so when the app does not export a stack', () => {
    expect(() => loadApp(writeApp('module.exports = {};'), {})).toThrow('App must export a Stack instance with a synth() method');
  });

  it('says how to provide the API key when there is none', () => {
    const file = writeApp(`module.exports = { synth: () => ({ stackId: 'Shop', tags: {}, resources: [] }) };`);

    expect(() => loadApp(file, {})).toThrow(/Stripe API key not found/);
  });
});
