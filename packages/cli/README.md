# @pricectl/cli

Command-line interface for [pricectl](https://github.com/hideokamoto/pricectl) — a kubectl-style tool for managing Stripe pricing resources with TypeScript.

## Installation

```bash
# Global (recommended for CLI usage)
npm install -g @pricectl/cli
# or
pnpm add -g @pricectl/cli
```

After installation the `pricectl` binary is available on your `PATH`.

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

Creates the following files if they don't already exist:

| File | Description |
|------|-------------|
| `pricectl.ts` | Example stack definition |
| `package.json` | Project manifest with `synth`, `diff`, and `deploy` scripts |
| `tsconfig.json` | TypeScript compiler configuration |
| `.env.example` | Template for your Stripe API key |
| `.gitignore` | Sensible defaults (`.env`, `pricectl.out/`, `node_modules/`) |

**Flags**

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Overwrite existing files |

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

---

### `pricectl diff`

Show the difference between your local stack definition and the resources currently deployed in Stripe.

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

Show what `deploy` would do to Stripe, without changing anything. Exits with an error when a
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
| `--force` | `-f` | `false` | Remove resources that are no longer defined without asking |
| `--frozen-lock` | | `false` | Fail instead of updating `pricectl.lock.json` when it is out of date (for CI) |

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

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Skip confirmation prompt |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_test_...` or `sk_live_...`) |

The key can also be supplied via `Stack` props in your stack definition file.

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
