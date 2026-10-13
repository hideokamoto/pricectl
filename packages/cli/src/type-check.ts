import * as path from 'path';
import type * as TypeScript from 'typescript';

/**
 * Format a compiler diagnostic for the terminal as `file:line:col - error TSxxxx: message`,
 * with the file relative to `cwd`. Further messages of a chain follow on indented lines.
 */
export function formatDiagnostic(ts: typeof TypeScript, diagnostic: TypeScript.Diagnostic, cwd: string): string {
  const [first, ...rest] = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n');
  const label = `${ts.DiagnosticCategory[diagnostic.category].toLowerCase()} TS${diagnostic.code}`;
  const message = [`${label}: ${first}`, ...rest.map((line) => `  ${line}`)].join('\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${path.relative(cwd, diagnostic.file.fileName)}:${line + 1}:${character + 1} - ${message}`;
}

/**
 * Compiler options used when the project has no tsconfig.json, written as in a tsconfig.json.
 * The stack definition is loaded with `require` (CommonJS) by esbuild-register, so it is
 * checked as CommonJS resolved like Node, and strictly.
 */
export const DEFAULT_LINT_COMPILER_OPTIONS = {
  strict: true,
  noEmit: true,
  target: 'ES2020',
  module: 'commonjs',
  moduleResolution: 'node',
  lib: ['ES2020'],
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  resolveJsonModule: true,
};

/**
 * The options `pricectl lint` checks with: the project's own (from its tsconfig.json) when it
 * has them, otherwise {@link DEFAULT_LINT_COMPILER_OPTIONS}. Nothing is ever emitted.
 */
export function compilerOptionsForLint(
  ts: typeof TypeScript,
  project: TypeScript.CompilerOptions | undefined,
): TypeScript.CompilerOptions {
  if (project) {
    return { ...project, noEmit: true };
  }
  return ts.convertCompilerOptionsFromJson(DEFAULT_LINT_COMPILER_OPTIONS, '').options;
}
