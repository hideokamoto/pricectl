# @pricectl/cli

Command-line interface for [pricectl](https://github.com/hideokamoto/pricectl) — a kubectl-style tool for managing Stripe pricing resources with TypeScript.

## Installation

```bash
# Global (recommended for CLI usage)
npm install -g @pricectl/cli
# or
pnpm add -g @pricectl/cli
```

Requires Node.js 20 or later. After installation the `pricectl` binary is available on your `PATH`.

## Quick Start

```bash
# 1. Create a new project directory
mkdir my-pricing && cd my-pricing

# 2. Initialise the project (creates pricectl.ts, package.json, tsconfig.json)
pricectl init

# 3. Set your Stripe secret key
export STRIPE_SECRET_KEY=sk_test_...

# 4. Install dependencies
npm install

# 5. Preview changes
npm run diff

# 6. Deploy to Stripe
npm run deploy
```

## Commands

### `pricectl init`

Initialise a new pricectl project in the current directory.

```bash
pricectl init
pricectl init --force   # Overwrite existing files
```

Creates the following files if they don't already exist. With `--force`, `tsconfig.json`,
`pricectl.ts` and `.env.example` are overwritten and the missing entries are appended to an
existing `.gitignore`; `package.json` is never overwritten. `init` does not install dependencies.

| File | Description |
|------|-------------|
| `pricectl.ts` | Example stack definition |
| `package.json` | Project manifest with `synth`, `plan`, `diff`, and `deploy` scripts |
| `tsconfig.json` | TypeScript compiler configuration |
| `.env.example` | Template for your Stripe API key |
| `.gitignore` | Sensible defaults (`.env`, `pricectl.out/`, `node_modules/`) |

**Flags**

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Overwrite `tsconfig.json`, `pricectl.ts` and `.env.example`, and add missing entries to `.gitignore` |
| `--typescript` | `-t` | Has no effect: the project is always TypeScript (kept for compatibility) |

---

### `pricectl lint`

Type-check your stack definition, like `tsc --noEmit`. pricectl runs the definition without
checking types, so `synth`, `plan` and `deploy` run definitions that do not type-check; `lint`
is the separate step that catches them, for example `isDefault: true` together with
`active: false` on a `Price`. It does not read Stripe.

```bash
pricectl lint
pricectl lint --app ./infra/main.ts
```

Each error is printed as `file:line:col - error TSxxxx: message`. The command exits with 1
when there is a type error and with 0 otherwise.

**Which compiler options are used**

- The `tsconfig.json` found from the definition's directory upward (as `tsc` finds it) is used
  with all its options, including `extends` and `paths`; only emitting is turned off, and
  `noCheck` is ignored, since the command exists to check. The
  definition, the files it imports and the declaration files (`.d.ts`) the `tsconfig.json`
  includes are checked. Other files of the project are not, so an error in a test or script
  that the definition does not import does not fail `lint`.
- Without a `tsconfig.json`, the options `pricectl init` writes are used, plus `noEmit`:
  `strict`, `target: ES2020`, `module: commonjs`, `moduleResolution: node`,
  `lib: ["ES2020"]`, `esModuleInterop`, `skipLibCheck`, `forceConsistentCasingInFileNames`
  and `resolveJsonModule`.

`lint` uses the TypeScript 5 compiler that comes with `@pricectl/cli`, whatever TypeScript
version your project has installed.

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |

---

### `pricectl synth`

Synthesize your stack into a JSON manifest (`pricectl.out/manifest.json`).

```bash
pricectl synth
pricectl synth --app ./infra/main.ts
pricectl synth --output ./build
```

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |
| `--output` | `-o` | `./pricectl.out` | Output directory for the manifest |
| `--frozen-lock` | | `false` | Fail instead of updating `pricectl.lock.json` when it is out of date (for CI) |

`synth` does not contact Stripe, but loading the stack definition still needs a Stripe API key
(see [Environment Variables](#environment-variables)). It also creates or updates
`pricectl.lock.json` in the current directory.

---

### `pricectl diff`

Show the difference between your local stack definition and the resources currently deployed in Stripe.
`diff` changes nothing in Stripe, does not write `pricectl.lock.json`, and exits with 0 whether or
not there are differences.

```bash
pricectl diff
pricectl diff --app ./infra/main.ts
```

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |

---

### `pricectl plan`

Show what `deploy` would do to Stripe, without changing Stripe (it may update
`pricectl.lock.json`). Exits with an error when a
step would be rejected.

```bash
pricectl plan
pricectl plan --frozen-lock
```

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |
| `--frozen-lock` | | `false` | Fail instead of updating `pricectl.lock.json` when it is out of date (for CI) |

---

### `pricectl deploy`

Deploy your stack to Stripe (creates, updates and removes resources). It builds the plan that
`pricectl plan` shows and applies exactly those steps. See the repository README for how
resources are found and how price changes work.

```bash
pricectl deploy
pricectl deploy --app ./infra/main.ts
pricectl deploy --frozen-lock --force
```

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |
| `--dry-run` | | `false` | Print the plan without changing Stripe, like `pricectl plan` |
| `--force` | `-f` | `false` | Remove resources that are no longer defined without asking |
| `--frozen-lock` | | `false` | Fail instead of updating `pricectl.lock.json` when it is out of date (for CI) |

Creating and updating resources is not confirmed; only removals are. Without an interactive
terminal (in CI), deploy stops without changing Stripe when there is something to remove,
unless `--force` is given (`pricectl.lock.json` may already have been updated).

---

### `pricectl destroy`

Remove all resources defined in your stack from Stripe.

```bash
pricectl destroy --force
```

Before changing anything, destroy reads the current state of each resource from Stripe and
lists only the ones it would delete or deactivate. Resources that are already deleted or
inactive are left out, and when nothing is left the command ends without asking.
`pricectl destroy --dry-run` shows the same list without changing Stripe.

> **Warning:** This action is irreversible. Use `--force` to skip the confirmation prompt.

**Flags**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--app` | `-a` | `./pricectl.ts` | Path to the stack definition file |
| `--dry-run` | | `false` | Print what would be removed without changing Stripe or `pricectl.lock.json` |
| `--force` | `-f` | `false` | Skip the confirmation prompt (needed without an interactive terminal) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_test_...` or `sk_live_...`) |

The key can also be supplied via `Stack` props in your stack definition file. Every command that
loads the stack definition (`synth`, `diff`, `plan`, `deploy`, `destroy`) needs one; `lint` and
`init` do not. pricectl does not read a `.env` file: export the variable in your shell or CI.

`pricectl.lock.json` is read from and written to the current directory, not the directory of the
stack definition, so run the commands from the directory where you commit the lock.

Run `pricectl --help` or `pricectl <command> --help` for the same information in the terminal.

## Project Structure

After running `pricectl init` your project will look like this:

```
my-pricing/
├── pricectl.ts        # Stack definition (edit this)
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

### Example `pricectl.ts`

```typescript
import { Stack } from '@pricectl/core';
import { Product, Price, Coupon } from '@pricectl/constructs';

const stack = new Stack(undefined, 'MyStack', {
  description: 'My Stripe Infrastructure',
});

const product = new Product(stack, 'PremiumPlan', {
  name: 'Premium Plan',
  description: 'Access to all premium features',
  active: true,
});

new Price(stack, 'MonthlyPrice', {
  product,
  currency: 'usd',
  unitAmount: 1999, // $19.99/month
  recurring: { interval: 'month' },
});

new Coupon(stack, 'WelcomeCoupon', {
  name: 'Welcome Discount',
  percentOff: 20,
  duration: 'once',
});

export default stack;
```

## Related Packages

| Package | Description |
|---------|-------------|
| [`@pricectl/core`](../core/README.md) | Core IaC framework (Construct, Stack, Resource) |
| [`@pricectl/constructs`](../constructs/README.md) | Stripe resource constructs (Product, Price, Coupon) |

## License

MIT
