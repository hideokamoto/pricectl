# Agent instructions for pricectl

The rules for working in this repository (test-driven development, the test pyramid, code
style) are in [CLAUDE.md](./CLAUDE.md); they apply to every coding agent, not only Claude Code.

## Agent Skill

[`skills/pricectl/SKILL.md`](./skills/pricectl/SKILL.md) is an
[Agent Skill](https://agentskills.io/specification) that tells agents how to use the pricectl
CLI. Users install it with:

```bash
npx skills add hideokamoto/pricectl
```

When you change the CLI (a command, a flag, what a command reads or writes, or a version
requirement), update the skill and the `--help` text in the same change.
`packages/cli/src/__tests__/skill.test.ts` fails when the skill names a command or flag the CLI
does not have, or a Node.js version other than the `engines` field of `@pricectl/cli`. Check
the skill with:

```bash
uvx --from skills-ref agentskills validate skills/pricectl
```

The skill is not published to npm: the packages under `packages/` only ship what their `files`
field lists.
