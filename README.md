# pricectl

<p align="center">
  <strong>Control your pricing infrastructure as code</strong>
</p>

<p align="center">
  kubectl-style tool for managing Stripe pricing resources with TypeScript
</p>

---

## Overview

pricectl is an Infrastructure as Code (IaC) tool for Stripe pricing resources. Inspired by kubectl and AWS CDK, it allows you to define your pricing infrastructure (products, prices, coupons, entitlement features, billing meters) using TypeScript and deploy them with simple CLI commands.

### Why pricectl?

- **Type-Safe**: Define resources with TypeScript for full IDE support and compile-time checks
- **Declarative**: Describe what you want, not how to create it
- **Version Control**: Track changes to your pricing infrastructure in git
- **Reproducible**: Deploy the same configuration across multiple environments
- **Preview Changes**: See exactly what will change before deploying
- **Familiar DX**: kubectl-style commands (synth, diff, deploy)

## Quick Start

### Installation

```bash
# Using npm
npm install -g @pricectl/cli

# Using pnpm
pnpm add -g @pricectl/cli

# Using yarn
yarn global add @pricectl/cli
```

### Initialize a New Project

```bash
mkdir my-pricing-infrastructure
cd my-pricing-infrastructure
pricectl init
```

This creates a basic project structure:

```
my-pricing-infrastructure/
├── pricectl.ts        # Your stack definition
├── package.json
├── tsconfig.json
└── .env.example
```

### Define Your Infrastructure

Edit `pricectl.ts`:

```typescript
import { Stack } from '@pricectl/core';
import { Product, Price, Coupon } from '@pricectl/constructs';

// Create a stack
const stack = new Stack(undefined, 'MyStack', {
  description: 'My Stripe Infrastructure',
});

// Define a product
const product = new Product(stack, 'PremiumPlan', {
  name: 'Premium Plan',
  description: 'Access to all premium features',
  active: true,
});

// Add monthly pricing
new Price(stack, 'MonthlyPrice', {
  product,
  currency: 'usd',
  unitAmount: 1999, // $19.99
  recurring: {
    interval: 'month',
  },
});

// Add a promotional coupon
new Coupon(stack, 'Launch20', {
  name: 'Launch Discount',
  percentOff: 20,
  duration: 'once',
});

export default stack;
```

### Deploy to Stripe

```bash
# Set your Stripe API key
export STRIPE_SECRET_KEY=sk_test_...

# Preview changes
npm run diff

# Deploy to Stripe
npm run deploy
```

## Architecture

pricectl is a monorepo containing three main packages:

### 📦 `@pricectl/core`

Core IaC framework providing:
- `Construct`: Base class for all resources
- `Stack`: Container for resources (its `tags` are added to every resource's Stripe metadata)
- `Resource`: Base class for Stripe resources

### 📦 `@pricectl/constructs`

Stripe pricing resource implementations:
- `Product`: Stripe products
- `Price`: Pricing plans (one-time, recurring, tiered, metered)
- `Coupon`: Discount coupons
- `EntitlementFeature`: Entitlement features for access control
- `Meter`: Billing meters for usage-based pricing
- Coming soon: PromotionCodes

### 📦 `@pricectl/cli`

Command-line interface:
- `pricectl init`: Initialize a new project
- `pricectl synth`: Synthesize stack to manifest
- `pricectl diff`: Compare local vs deployed
- `pricectl plan`: Show what deploy would do, without changing anything
- `pricectl deploy`: Deploy to Stripe
- `pricectl destroy`: Remove all resources

## CLI Commands

### `pricectl init`

Initialize a new pricectl project with example code.

```bash
pricectl init
```

### `pricectl synth`

Synthesize your stack into a deployment manifest.

```bash
pricectl synth
pricectl synth --app ./custom-stack.ts
```

### `pricectl diff`

Show differences between your local definition and what's deployed in Stripe.

```bash
pricectl diff
pricectl diff --app ./custom-stack.ts
```

### `pricectl plan`

Show what `deploy` would do to Stripe, without changing anything.

```bash
pricectl plan
pricectl plan --frozen-lock   # CI: fail instead of updating pricectl.lock.json
```

`plan` reads Stripe and lists every step `deploy` would take. When Stripe would reject a step
(a lookup key held by a price outside the stack, a coupon field that cannot change), `plan`
says so and exits with an error; `deploy` then changes nothing.

### `pricectl deploy`

Deploy your stack to Stripe. `deploy` builds the same plan as `pricectl plan`, shows it, and
applies exactly those steps.

```bash
pricectl deploy
pricectl deploy --app ./custom-stack.ts
pricectl deploy --frozen-lock --force   # CI
```

**How resources are found.** pricectl names what it creates, so it finds it again without
listing your account: products and coupons get the ID `{stackId}_{logicalId}`, prices get that
string as their lookup key (unless you set `lookupKey`), entitlement features are found by
`lookupKey`, and billing meters by the event name among the active meters. Changing a logical ID
or a lookup key therefore replaces the object (`plan` warns when it looks like a rename).

**Changing a price.** Stripe cannot change the amount, currency, recurring interval, tiers or
product of a price, nor `tax_behavior` once it is set. `deploy` then creates a new version, moves
the lookup key to it, moves the product's default price to it, and archives the old version.
Nickname, `active`, metadata, the lookup key and an unset `tax_behavior` are updated in place.
Declare `isDefault: true` on a price to make it the default price of its product; otherwise
pricectl follows what is set in Stripe. A lookup key held by a price pricectl does not manage is
taken over only with `transferLookupKey: true`.

**`pricectl.lock.json`.** Stripe cannot remember what you removed from your code, so
`synth`, `plan` and `deploy` keep a lock file with the keys your stack claims. Commit it to Git.
It depends only on your definition. A key that leaves the definition becomes `removing`, and
the next `deploy` removes its object (prices are archived, products are deleted or archived when
they have prices, coupons are deleted, features and meters are deactivated). A `removing` entry
stays in the lock until you delete it from the file, which lets pricectl forget the key.
In CI use `--frozen-lock`: `deploy` then fails when the lock is out of date instead of
rewriting it, so run `pricectl synth` locally and commit the result.

Before removing anything, deploy lists the resources and asks for confirmation.
Use `--force` (`-f`) to skip the prompt; in a non-interactive environment such as CI,
deploy stops without changes unless `--force` is given. `pricectl deploy --dry-run` does what
`pricectl plan` does: it reads Stripe and shows, for each resource, whether it would be created,
updated or left unchanged (a price whose terms changed is created as a new version), plus the
resources that would be removed. It needs the Stripe API key, like `diff`.

Run one deploy of a stack at a time (for example one CI job per stack, with a concurrency
group): Stripe has no lock, and two deploys at once can leave a removed object on sale until
the next deploy runs alone.

### `pricectl destroy`

Remove all resources defined in your stack from Stripe.

```bash
pricectl destroy --force
```

Before changing anything, destroy reads the current state of each resource from Stripe and
lists only the ones it would delete or deactivate. Resources that are already deleted or
inactive are left out, and when nothing is left the command ends without asking.
`pricectl destroy --dry-run` shows the same list without changing Stripe. Resources you point to
with `physicalId` are not created by pricectl and are never removed by it.

## Available Resources

### Product

Define a Stripe product:

```typescript
const myProduct = new Product(stack, 'MyProduct', {
  name: 'My Product',
  description: 'Product description',
  active: true,
  images: ['https://example.com/image.png'],
  metadata: { key: 'value' },
  statementDescriptor: 'MY PRODUCT',
});
```

### Price

Define pricing for a product:

```typescript
// One-time payment
new Price(stack, 'OneTime', {
  product: myProduct,
  currency: 'usd',
  unitAmount: 4999, // $49.99
});

// Recurring subscription
new Price(stack, 'Monthly', {
  product: myProduct,
  currency: 'usd',
  unitAmount: 1999, // $19.99
  recurring: {
    interval: 'month',
  },
});

// Tiered, usage-based pricing (metered prices must bill through a Meter)
const apiCalls = new Meter(stack, 'ApiCalls', {
  displayName: 'API Calls',
  eventName: 'api_call',
  defaultAggregation: { formula: 'count' },
});

new Price(stack, 'Graduated', {
  product: myProduct,
  currency: 'usd',
  recurring: {
    interval: 'month',
    usageType: 'metered',
    meter: apiCalls,
  },
  tiersMode: 'graduated',
  tiers: [
    { upTo: 1000, unitAmount: 10 },
    { upTo: 10000, unitAmount: 5 },
    { upTo: 'inf', unitAmount: 2 },
  ],
});
```

### Coupon

Create promotional discounts:

```typescript
// Percentage discount
new Coupon(stack, 'Sale20', {
  percentOff: 20,
  duration: 'once',
  name: '20% Off',
});

// Fixed amount discount
new Coupon(stack, 'Save10', {
  amountOff: 1000, // $10.00
  currency: 'usd',
  duration: 'repeating',
  durationInMonths: 3,
});
```

### EntitlementFeature

Define entitlement features for access control:

```typescript
const premiumSupport = new EntitlementFeature(stack, 'PremiumSupport', {
  name: 'Premium Support',
  lookupKey: 'premium-support',
  metadata: { tier: 'premium' },
});

// Grant the feature through a product. Features not listed are detached on deploy;
// a product without `features` leaves its attached features untouched.
new Product(stack, 'Premium', {
  name: 'Premium Plan',
  features: [premiumSupport],
});
```

### Meter

Define billing meters for usage-based pricing:

```typescript
// Simple count-based meter
new Meter(stack, 'ApiCalls', {
  displayName: 'API Calls',
  eventName: 'api_call',
  defaultAggregation: {
    formula: 'count',
  },
});

// Sum-based meter with value settings
new Meter(stack, 'DataTransfer', {
  displayName: 'Data Transfer',
  eventName: 'data_transfer',
  defaultAggregation: {
    formula: 'sum',
  },
  valueSettings: {
    eventPayloadKey: 'bytes_used',
  },
  eventTimeWindow: 'hour',
});
```

## Examples

Check out the [examples](./examples) directory for complete working examples:

- **[basic-subscription](./examples/basic-subscription)**: Simple SaaS subscription with multiple tiers
- **[advanced-pricing](./examples/advanced-pricing)**: Advanced pricing strategies (tiered, metered, per-seat)

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/hideokamoto/pricectl.git
cd pricectl

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Project Structure

```
pricectl/
├── packages/
│   ├── core/          # Core IaC framework
│   ├── constructs/    # Stripe pricing constructs
│   └── cli/           # Command-line interface
├── examples/
│   ├── basic-subscription/
│   └── advanced-pricing/
├── pnpm-workspace.yaml
└── package.json
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
cd packages/core
pnpm build
```

### Testing

```bash
# Run tests for all packages
pnpm test

# Run tests for specific package
cd packages/constructs
pnpm test
```

## Roadmap

### v0.2.0
- [x] Entitlement resource
- [x] Meter resource
- [ ] PromotionCode resource
- [ ] Customer resource
- [ ] Subscription resource
- [ ] PaymentLink resource
- [x] State management (track deployed resources)

### v0.3.0
- [ ] Webhook configuration
- [ ] Tax rate management
- [ ] Shipping rate management
- [ ] Multi-stack support

### v1.0.0
- [ ] Full Stripe API coverage
- [ ] Import existing resources
- [ ] Stack dependencies
- [ ] Custom constructs / patterns

## Comparison with Other Tools

| Feature | pricectl | YAML/JSON | Terraform | Manual |
|---------|----------|-----------|-----------|--------|
| Type Safety | ✅ | ❌ | ⚠️ | ❌ |
| IDE Support | ✅ | ⚠️ | ⚠️ | N/A |
| Diff Preview | ✅ | ❌ | ✅ | ❌ |
| Version Control | ✅ | ✅ | ✅ | ❌ |
| Programmatic | ✅ | ❌ | ⚠️ | ✅ |
| Stripe-Native | ✅ | ✅ | ❌ | ✅ |
| Pricing-Focused | ✅ | ❌ | ❌ | ❌ |

## Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Credits

Inspired by [AWS CDK](https://aws.amazon.com/cdk/) and the amazing work by the AWS team.

---

<p align="center">
  Made with ❤️ for the Stripe developer community
</p>
