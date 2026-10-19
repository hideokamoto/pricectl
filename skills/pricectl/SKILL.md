---
name: pricectl
description: Define and deploy Stripe pricing (products, prices, coupons, entitlement features, billing meters) as TypeScript code with the pricectl CLI. Use this skill whenever a project has a pricectl.ts or pricectl.lock.json, depends on @pricectl/cli, @pricectl/core or @pricectl/constructs, or the user wants to create, change, preview, deploy or remove Stripe products, prices or coupons from code, even if they do not name pricectl. Covers pricectl init, lint, synth, diff, plan, deploy and destroy, and how to run them without changing Stripe by surprise.
license: MIT
compatibility: Requires Node.js 20 or later, npm or another Node.js package manager, network access to the Stripe API, and a Stripe API key in STRIPE_SECRET_KEY.
---

# pricectl

pricectl turns a TypeScript stack definition (`pricectl.ts` by default) into Stripe objects.
`plan` shows what would change, `deploy` applies it, and `pricectl.lock.json` remembers which
objects the stack owns so that removing something from the code removes it from Stripe.

Because `deploy` and `destroy` change a real Stripe account, and removals cannot be undone
(products and coupons are deleted, prices are archived), this skill always shows the user the
plan first and only applies it once they have said yes.

## Prerequisites

Check these before running any command, and tell the user what is missing instead of working
around it.

- **Node.js 20 or later** (`node --version`). `@pricectl/cli` and the Stripe SDK it uses
  require it.
- **The CLI.** In a project made with `pricectl init`, `@pricectl/cli` is a dev dependency, so
  run `npx pricectl <command>` after `npm install`. Otherwise it can be installed globally with
  `npm install -g @pricectl/cli`. The binary `pricectl` belongs to `@pricectl/cli`; this
  project does not publish a package named `pricectl`, so if `npx` offers to download one,
  decline and install `@pricectl/cli` instead.
- **A Stripe API key** for every command except `init` and `lint`, including `synth`, which
  does not contact Stripe but cannot load the definition without a key. The key is the stack's
  `apiKey`, or else the `STRIPE_SECRET_KEY` environment variable. pricectl does not read a
  `.env` file, so the variable must be exported in the shell or set in CI. Never print the key
  or write it into a file that is committed.
- **The right working directory.** `pricectl.lock.json` is read from and written to the
  current directory, not the directory of the definition file. Run every command from the
  directory where the lock is committed, and pass `--app <path>` when the definition is not
  `./pricectl.ts`.

Run `npx pricectl <command> --help` when unsure about a flag: the help states what each
command reads and writes.

## Stripe-side constraints

From the Stripe documentation (see the links at the end):

- **Sandbox and live mode are separate.** Keys starting with `sk_test_` or `rk_test_` belong to
  a sandbox, keys starting with `sk_live_` or `rk_live_` to live mode, and objects in one mode
  are not visible in the other. Look at the prefix of the key (without printing the rest)
  before planning, and say which mode the plan is for. Work in a sandbox unless the user has
  explicitly asked for live mode.
- **Restricted keys (`rk_...`) only do what they are permitted.** Stripe recommends them for
  keys given to AI agents. A request the key is not permitted to make fails with an invalid
  request error; Write permission includes Read, and `GET` requests need Read while `POST` and
  `DELETE` requests need Write.
- **What pricectl calls.** The CLI reads and writes these Stripe resources, so a restricted key
  needs Write on them (Read is enough for `diff` and `plan` only): Products (including the
  features attached to a product), Prices, Coupons, Entitlements Features and Billing Meters.

If Stripe rejects a request for lack of permission, report the error to the user and let them
change the key; do not switch to a different key on your own.

## Workflow: change the pricing

1. **Edit the definition.** Change `pricectl.ts` (or the file passed with `--app`). Resources
   are found again in Stripe by name: products and coupons by the ID `{stackId}_{constructId}`,
   prices by that string as lookup key (unless `lookupKey` is set), entitlement features by
   `lookupKey`, meters by event name. Renaming any of these replaces the Stripe object instead
   of updating it, so point such renames out to the user.
2. **Type-check.** Run `npx pricectl lint`. pricectl runs the definition without checking
   types, so fix every error `lint` reports before going on.
3. **Preview.** Run `npx pricectl plan` (the same as `npx pricectl deploy --dry-run`). It reads
   Stripe and lists every step, and exits with 1 when Stripe would refuse a step; fix those
   first. `plan` changes nothing in Stripe, but it does update `pricectl.lock.json` (use
   `--frozen-lock` to only check it).
4. **Ask for approval.** Show the user the plan, especially:
   - every resource that will be **removed** (deleted, archived or deactivated);
   - prices whose terms changed (product, currency, amounts, recurring settings, tiers or
     quantity transform): Stripe cannot change those, so pricectl creates a new price, moves
     the lookup key to it and archives the old one;
   - which Stripe mode (sandbox or live) the key points to.

   Wait for an explicit yes. A request such as "update the price" is not approval of a plan
   the user has not seen.
5. **Deploy.** Run `npx pricectl deploy` without `--force` first. `deploy` builds its plan
   again from your definition, the lock and what Stripe holds now, so it can differ from the
   plan the user approved if Stripe changed in between. Creating and updating resources is not
   confirmed by the CLI; only removals are. When something would be removed and there is no
   interactive terminal (as when an agent runs it), `deploy` prints the removals and stops
   without changing anything. Compare them with the removals the user approved: if they
   differ, stop and ask again; only if they match, run `npx pricectl deploy --force` at once.
6. **Commit the lock.** Tell the user to commit `pricectl.lock.json` together with the
   definition.

If `deploy` reports errors, show them to the user and run `plan` again before retrying: some
steps may already have been applied.

## Workflow: remove the whole stack

1. Run `npx pricectl destroy --dry-run` and show the list to the user. It reads Stripe and
   changes neither Stripe nor the lock.
2. After explicit approval, run `npx pricectl destroy --force` (without a terminal, destroy
   stops unless `--force` is given).

## Workflow: CI

Use `--frozen-lock` with `synth`, `plan` and `deploy`: the command then fails when the lock is
out of date instead of rewriting it, and the fix is to run `npx pricectl synth` locally and
commit the lock. Run one deploy of a stack at a time.

## Safety rules

- Never run `deploy` or `destroy` before running `plan` or `--dry-run` and getting the user's
  approval of what it showed.
- Never pass `--force` to get past a prompt the user has not answered.
- Never use a live-mode key unless the user explicitly asked to change live mode.
- Do not delete entries from `pricectl.lock.json` by hand; a `removing` entry stays there on
  purpose until the user decides pricectl should forget the key.
- Do not run `npx pricectl init --force` in an existing project without asking: it overwrites
  `pricectl.ts`, `tsconfig.json` and `.env.example`.

## References

- pricectl documentation: https://github.com/hideokamoto/pricectl#readme
- Stripe API keys, sandbox and live mode: https://docs.stripe.com/keys
- Stripe restricted API keys: https://docs.stripe.com/keys/restricted-api-keys
