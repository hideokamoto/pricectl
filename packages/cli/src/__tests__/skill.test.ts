import * as fs from 'fs';
import * as path from 'path';
import { DOCS_URL } from '../help';

/**
 * The Agent Skill in skills/pricectl is not shipped with the package, but it tells agents how to
 * run this CLI. These tests fail when the CLI changes in a way the skill no longer describes.
 */
const SKILL_DIR = path.resolve(__dirname, '../../../../skills/pricectl');
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8');
const cliPackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

/** The value of a single-line field of the SKILL.md frontmatter. */
function frontmatter(field: string): string {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
  return new RegExp(`^${field}: (.*)$`, 'm').exec(block)?.[1] ?? '';
}

describe('skills/pricectl/SKILL.md', () => {
  it('requires the Node.js major version that the engines field of @pricectl/cli requires', () => {
    const engineMajor = /^>=\s*(\d+)/.exec(cliPackage.engines.node)?.[1];

    expect(engineMajor).toBeDefined();
    expect(frontmatter('compatibility')).toContain(`Node.js ${engineMajor} or later`);
    expect(skill).toContain(`**Node.js ${engineMajor} or later**`);
    expect(skill.match(/Node\.js \d+/g)?.every((mention) => mention === `Node.js ${engineMajor}`)).toBe(true);
  });

  it('only runs commands that the CLI has', () => {
    const commands = new Set(fs.readdirSync(path.resolve(__dirname, '../commands')).map((file) => path.parse(file).name));
    const used = [...skill.matchAll(/npx pricectl ([a-z]+)/g)].map((match) => match[1]);

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((command) => !commands.has(command))).toEqual([]);
  });

  it('only uses flags that the CLI has', async () => {
    // oclif adds --help and --version to every CLI
    const flags = new Set<string>(['--help', '--version']);
    for (const file of fs.readdirSync(path.resolve(__dirname, '../commands'))) {
      const { default: command } = await import(path.resolve(__dirname, '../commands', file));
      for (const name of Object.keys(command.flags ?? {})) flags.add(`--${name}`);
    }
    const used = new Set(skill.match(/--[a-z][a-z-]+/g));

    expect([...used].filter((flag) => !flags.has(flag))).toEqual([]);
  });

  it('points to the documentation that the --help of the CLI points to', () => {
    expect(skill).toContain(DOCS_URL);
  });

  it('has the name of its directory and a description within the 1024 characters of the specification', () => {
    expect(frontmatter('name')).toBe(path.basename(SKILL_DIR));
    expect(frontmatter('description').length).toBeGreaterThan(0);
    expect(frontmatter('description').length).toBeLessThanOrEqual(1024);
  });
});
