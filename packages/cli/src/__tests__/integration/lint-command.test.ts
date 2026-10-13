import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Lint from '../../commands/lint';
import { runCommand } from '../helpers/run-command';

describe('pricectl lint', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-lint-command-')));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (file: string, content: string) => fs.writeFileSync(path.join(dir, file), content);

  it('exits 0 and says so when the definition type-checks', async () => {
    write('pricectl.ts', 'export const amount: number = 1000;\n');

    const run = await runCommand(Lint, []);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('✓ No type errors in pricectl.ts');
  });

  it('prints each type error as file:line:col and exits 1', async () => {
    write('pricectl.ts', "export const amount: number = 'free';\nexport function price(value) { return value; }\n");

    const run = await runCommand(Lint, []);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain("pricectl.ts:1:14 - error TS2322: Type 'string' is not assignable to type 'number'.");
    expect(run.stdout).toContain("pricectl.ts:2:23 - error TS7006: Parameter 'value' implicitly has an 'any' type.");
    expect(run.error?.message).toBe('Found 2 type errors in pricectl.ts');
  });

  it("says which compiler options were used: pricectl's defaults when there is no tsconfig.json", async () => {
    write('pricectl.ts', 'export const amount = 1000;\n');

    const run = await runCommand(Lint, []);

    expect(run.stdout).toContain("Type-checking pricectl.ts with pricectl's default compiler options (no tsconfig.json found)");
  });

  it('says which tsconfig.json was used, and follows its options', async () => {
    write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: false } }));
    fs.mkdirSync(path.join(dir, 'infra'));
    write('infra/main.ts', 'export function price(value) { return value; }\n');

    const run = await runCommand(Lint, ['--app', 'infra/main.ts']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Type-checking infra/main.ts with tsconfig.json');
  });

  it('fails when the app file does not exist', async () => {
    const run = await runCommand(Lint, ['--app', 'missing.ts']);

    expect(run.exitCode).toBe(1);
    expect(run.error?.message).toBe(`App file not found: ${path.join(dir, 'missing.ts')}`);
  });
});
