import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { formatDiagnostic, typeCheckApp } from '../../type-check';

const PACKAGES = path.resolve(__dirname, '../../../..');

/** A tsconfig.json that resolves the pricectl packages to their sources, as an installed project would. */
function pricectlTsconfig(compilerOptions: Record<string, unknown> = {}) {
  return {
    compilerOptions: {
      strict: true,
      module: 'commonjs',
      moduleResolution: 'node',
      esModuleInterop: true,
      skipLibCheck: true,
      paths: {
        '@pricectl/core': [path.join(PACKAGES, 'core/src')],
        '@pricectl/constructs': [path.join(PACKAGES, 'constructs/src')],
      },
      ...compilerOptions,
    },
  };
}

const priceDefinition = (priceProps: string) => `import { Stack } from '@pricectl/core';
import { Price, Product } from '@pricectl/constructs';

const stack = new Stack(undefined, 'Shop', { apiKey: 'sk_test_dummy' });
const product = new Product(stack, 'Pro', { name: 'Pro' });
new Price(stack, 'ProMonthly', { product, currency: 'usd', unitAmount: 1000, ${priceProps} });

export default stack;
`;

describe('typeCheckApp', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pricectl-lint-test-')));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (file: string, content: string | object) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return target;
  };

  const codes = (diagnostics: readonly ts.Diagnostic[]) => diagnostics.map((d) => d.code);

  describe('with a tsconfig.json', () => {
    it('reports nothing for a stack definition that type-checks', () => {
      write('tsconfig.json', pricectlTsconfig());
      const app = write('pricectl.ts', priceDefinition('isDefault: true'));

      const result = typeCheckApp(ts, app);

      expect(result.diagnostics.map((d) => formatDiagnostic(ts, d, dir))).toEqual([]);
    });

    it('rejects a default price that is not on sale, at the line of the price', () => {
      write('tsconfig.json', pricectlTsconfig());
      const app = write('pricectl.ts', priceDefinition('isDefault: true, active: false'));

      const result = typeCheckApp(ts, app);

      expect(result.diagnostics).toHaveLength(1);
      expect(formatDiagnostic(ts, result.diagnostics[0], dir)).toMatch(
        /^pricectl\.ts:6:32 - error TS2345: .*\n.*Types of property 'active' are incompatible\./,
      );
    });

    it('uses the tsconfig.json found in a parent directory, as tsc does, and reports which one', () => {
      const configFile = write('tsconfig.json', { compilerOptions: { strict: false } });
      const app = write('infra/pricectl.ts', 'export function price(amount) { return amount; }\n');

      const result = typeCheckApp(ts, app);

      expect(result).toEqual({ configFile, diagnostics: [] });
    });

    it('follows the options a tsconfig.json takes from the one it extends', () => {
      write('tsconfig.base.json', { compilerOptions: { strict: true } });
      write('tsconfig.json', { extends: './tsconfig.base.json' });
      const app = write('pricectl.ts', 'export function price(amount) { return amount; }\n');

      expect(codes(typeCheckApp(ts, app).diagnostics)).toEqual([7006]);
    });

    it('checks the definition even when the tsconfig.json does not include it', () => {
      write('tsconfig.json', { compilerOptions: { strict: true }, include: ['src/**/*'] });
      const app = write('pricectl.ts', 'export const amount: number = 1000;\n');

      expect(codes(typeCheckApp(ts, app).diagnostics)).toEqual([]);
    });

    it('sees the declaration files the tsconfig.json includes but not errors in unrelated files', () => {
      write('tsconfig.json', { compilerOptions: { strict: true }, include: ['**/*'] });
      write('types/env.d.ts', 'declare const PLAN_CURRENCY: string;\n');
      write('scripts/unrelated.ts', "export const broken: number = 'not a number';\n");
      const app = write('pricectl.ts', 'export const currency: string = PLAN_CURRENCY;\n');

      expect(codes(typeCheckApp(ts, app).diagnostics)).toEqual([]);
    });

    it('reports a problem in the tsconfig.json itself', () => {
      write('tsconfig.json', { compilerOptions: { strictt: true } });
      const app = write('pricectl.ts', 'export const amount = 1000;\n');

      expect(codes(typeCheckApp(ts, app).diagnostics)).toEqual([5025]);
    });
  });

  describe('without a tsconfig.json', () => {
    it('reports nothing for a definition that type-checks', () => {
      const app = write('pricectl.ts', 'export const amount: number = 1000;\n');

      expect(typeCheckApp(ts, app)).toEqual({ configFile: undefined, diagnostics: [] });
    });

    it('checks strictly, so an implicit any is an error', () => {
      const app = write('pricectl.ts', 'export function price(amount) { return amount; }\n');

      expect(codes(typeCheckApp(ts, app).diagnostics)).toEqual([7006]);
    });
  });
});
