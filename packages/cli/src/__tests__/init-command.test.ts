import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Init from '../commands/init';
import { runCommand } from './helpers/run-command';

describe('init command', () => {
  let projectDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-init-'));
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const file = (name: string) => path.join(projectDir, name);

  it('with --force overwrites pricectl.ts but never package.json, as its help says', async () => {
    fs.writeFileSync(file('package.json'), '{"name":"mine"}');
    fs.writeFileSync(file('pricectl.ts'), '// mine');

    const run = await runCommand(Init, ['--force']);

    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(file('package.json'), 'utf-8')).toBe('{"name":"mine"}');
    expect(fs.readFileSync(file('pricectl.ts'), 'utf-8')).not.toBe('// mine');
  });

  it('with --force adds the missing entries to an existing .gitignore instead of replacing it', async () => {
    fs.writeFileSync(file('.gitignore'), 'coverage/\n');

    await runCommand(Init, ['--force']);

    const lines = fs.readFileSync(file('.gitignore'), 'utf-8').split('\n');
    expect(lines).toEqual(expect.arrayContaining(['coverage/', '.env', 'pricectl.out/']));
  });

  it('without --force keeps an existing .gitignore as it is', async () => {
    fs.writeFileSync(file('.gitignore'), 'coverage/\n');

    await runCommand(Init, []);

    expect(fs.readFileSync(file('.gitignore'), 'utf-8')).toBe('coverage/\n');
  });

  it('writes the same files with or without --typescript, which has no effect', async () => {
    await runCommand(Init, []);
    const without = fs.readdirSync(projectDir).sort();
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.mkdirSync(projectDir);

    await runCommand(Init, ['--typescript']);

    expect(fs.readdirSync(projectDir).sort()).toEqual(without);
  });
});
