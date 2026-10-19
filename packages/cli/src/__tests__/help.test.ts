import * as path from 'path';
import { Config } from '@oclif/core';
import PricectlHelp, { DOCS_URL } from '../help';

const PACKAGE_ROOT = path.resolve(__dirname, '../..');

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Render `pricectl [argv] --help` in-process and return what the user would see. */
async function renderHelp(argv: string[]): Promise<string> {
  const config = await Config.load(PACKAGE_ROOT);
  let stdout = '';
  const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
  try {
    await new PricectlHelp(config, { stripAnsi: true }).showHelp(argv);
  } finally {
    write.mockRestore();
  }
  // Join the lines oclif wraps at the terminal width, so that assertions do not depend on it
  return stdout.replace(ANSI, '').replace(/\n {2,}/g, ' ');
}

describe('pricectl --help', () => {
  it('ends the root help with the documentation URL', async () => {
    const help = await renderHelp([]);

    expect(help.trimEnd().endsWith(`DOCUMENTATION ${DOCS_URL}`)).toBe(true);
  });

  it('ends the help of a command with the documentation URL', async () => {
    const help = await renderHelp(['deploy']);

    expect(help.trimEnd().endsWith(`DOCUMENTATION ${DOCS_URL}`)).toBe(true);
  });

  it.each(['synth', 'diff', 'plan', 'deploy', 'destroy'])(
    'says in the help of %s that loading the app file needs a Stripe API key, and that .env is not read',
    async (command) => {
      const help = await renderHelp([command]);

      expect(help).toContain('STRIPE_SECRET_KEY');
      expect(help).toContain('.env file is not read');
    },
  );

  it('says in the help of lint that it needs no Stripe API key', async () => {
    const help = await renderHelp(['lint']);

    expect(help).toContain('needs no Stripe API key');
  });

  it.each(['synth', 'plan', 'deploy'])('says in the help of %s that it writes pricectl.lock.json in the current directory', async (command) => {
    const help = await renderHelp([command]);

    expect(help).toContain('pricectl.lock.json in the current directory');
  });

  it('says in the help of diff that it does not write pricectl.lock.json and exits with 0 on differences', async () => {
    const help = await renderHelp(['diff']);

    expect(help).toContain('does not write pricectl.lock.json');
    expect(help).toContain('Exits with 0 whether or not there are differences');
  });

  it('says in the help of deploy that only removals are confirmed, and that --force is needed without a terminal', async () => {
    const help = await renderHelp(['deploy']);

    expect(help).toContain('Creating and updating resources is not confirmed');
    expect(help).toContain('without an interactive terminal');
    expect(help).toContain('stops without changing Stripe');
  });

  it('says in the help of init that --typescript has no effect and that --force never overwrites package.json', async () => {
    const help = await renderHelp(['init']);

    expect(help).toMatch(/--typescript\s+Has no effect/);
    expect(help).toContain('package.json is never overwritten');
  });
});
