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
