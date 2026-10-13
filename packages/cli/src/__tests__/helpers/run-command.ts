import * as path from 'path';
import { Command, Config, ux } from '@oclif/core';

type CommandClass = { run(argv: string[], config: Config): Promise<unknown> };

const PACKAGE_ROOT = path.resolve(__dirname, '../../..');

export const FIXTURE_APPS = path.resolve(__dirname, '../fixtures/apps');

export interface CommandRun {
  /** Everything the command printed to stdout, without color codes. */
  stdout: string;
  /** The error the command ended with, if it did not complete normally. */
  error?: Error & { oclif?: { exit?: number } };
  /** The exit code the command ended with (0 when it completed normally). */
  exitCode: number;
}

export interface RunOptions {
  /** Whether stdin is an interactive terminal (default: false, as in CI). */
  interactive?: boolean;
  /** The answer given to a confirmation prompt; the prompt fails the test when it is not set. */
  confirm?: boolean;
  env?: Record<string, string | undefined>;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Run a CLI command in-process the way oclif does, and report what the user would see.
 * The terminal (stdin, the confirmation prompt) and the environment are the boundary replaced here.
 */
export async function runCommand(command: CommandClass, argv: string[], options: RunOptions = {}): Promise<CommandRun> {
  const config = await Config.load(PACKAGE_ROOT);
  let stdout = '';
  const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
  const confirm = jest.spyOn(ux, 'confirm').mockImplementation(async () => {
    if (options.confirm === undefined) throw new Error('Unexpected confirmation prompt');
    return options.confirm;
  });
  const originalTty = process.stdin.isTTY;
  const originalEnv = { ...process.env };
  process.stdin.isTTY = Boolean(options.interactive);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await command.run(argv, config);
    return { stdout: stdout.replace(ANSI, ''), exitCode: 0 };
  } catch (error) {
    const err = error as CommandRun['error'];
    return { stdout: stdout.replace(ANSI, ''), error: err, exitCode: err?.oclif?.exit ?? 1 };
  } finally {
    write.mockRestore();
    confirm.mockRestore();
    process.stdin.isTTY = originalTty;
    process.env = originalEnv;
  }
}

export type { Command };
