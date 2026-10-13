import * as path from 'path';
import * as ts from 'typescript';
import { formatDiagnostic } from '../type-check';

const CWD = path.join(path.sep, 'project');

/** A diagnostic as the compiler reports it, located in an in-memory source file. */
function diagnosticAt(
  source: string,
  needle: string,
  messageText: string | ts.DiagnosticMessageChain,
  code = 2345,
): ts.Diagnostic {
  const file = ts.createSourceFile(path.join(CWD, 'pricectl.ts'), source, ts.ScriptTarget.ES2020);
  return { file, start: source.indexOf(needle), length: needle.length, messageText, category: ts.DiagnosticCategory.Error, code };
}

describe('formatDiagnostic', () => {
  it('names the file relative to the working directory with a 1-based line and column', () => {
    const diagnostic = diagnosticAt("const a = 1;\nconst b: number = 'x';\n", 'b', "Type 'string' is not assignable to type 'number'.", 2322);

    expect(formatDiagnostic(ts, diagnostic, CWD)).toBe(
      "pricectl.ts:2:7 - error TS2322: Type 'string' is not assignable to type 'number'.",
    );
  });

  it('prints each further message of a chain on its own indented line', () => {
    const chain: ts.DiagnosticMessageChain = {
      messageText: "Argument of type '{ active: false; }' is not assignable to parameter of type 'PriceProps'.",
      category: ts.DiagnosticCategory.Error,
      code: 2345,
      next: [
        {
          messageText: "Types of property 'active' are incompatible.",
          category: ts.DiagnosticCategory.Error,
          code: 2326,
          next: [
            { messageText: "Type 'false' is not assignable to type 'true'.", category: ts.DiagnosticCategory.Error, code: 2322 },
          ],
        },
      ],
    };
    const diagnostic = diagnosticAt('new Price(stack, "P", { active: false });\n', '{ active', chain);

    expect(formatDiagnostic(ts, diagnostic, CWD).split('\n')).toEqual([
      "pricectl.ts:1:23 - error TS2345: Argument of type '{ active: false; }' is not assignable to parameter of type 'PriceProps'.",
      "    Types of property 'active' are incompatible.",
      "      Type 'false' is not assignable to type 'true'.",
    ]);
  });

  it('prints a diagnostic that has no file location, such as a tsconfig problem, without one', () => {
    const diagnostic: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: "Unknown compiler option 'strictt'.",
      category: ts.DiagnosticCategory.Error,
      code: 5023,
    };

    expect(formatDiagnostic(ts, diagnostic, CWD)).toBe("error TS5023: Unknown compiler option 'strictt'.");
  });

  it('labels a warning as a warning', () => {
    const diagnostic = { ...diagnosticAt('let x = 1;\n', 'x', 'Something to look at.', 9999), category: ts.DiagnosticCategory.Warning };

    expect(formatDiagnostic(ts, diagnostic, CWD)).toBe('pricectl.ts:1:5 - warning TS9999: Something to look at.');
  });
});
