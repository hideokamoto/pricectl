# pricectl

<p align="center">
  <strong>Control your pricing infrastructure as code</strong>
</p>

<p align="center">
  kubectl-style tool for managing Stripe pricing resources with TypeScript
</p>

---

## Overview

pricectl is an Infrastructure as Code (IaC) tool for Stripe pricing resources. Inspired by kubectl and AWS CDK, it allows you to define your pricing infrastructure (products, prices, coupons, entitlements, meters) using TypeScript and deploy them with simple CLI commands.

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
- `Stack`: Container for resources
- `Resource`: Base class for Stripe resources

### 📦 `@pricectl/constructs`

Stripe pricing resource implementations:
- `Product`: Stripe products
- `Price`: Pricing plans (one-time, recurring, tiered, metered)
- `Coupon`: Discount coupons
- Coming soon: Entitlements, Meters, PromotionCodes

### 📦 `@pricectl/cli`

Command-line interface:
- `pricectl init`: Initialize a new project
- `pricectl synth`: Synthesize stack to manifest
- `pricectl diff`: Compare local vs deployed
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

### `pricectl deploy`

Deploy your stack to Stripe.

```bash
pricectl deploy
pricectl deploy --app ./custom-stack.ts
```

### `pricectl destroy`

Remove all resources defined in your stack from Stripe.

```bash
pricectl destroy --force
```

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

// Tiered pricing
new Price(stack, 'Graduated', {
  product: myProduct,
  currency: 'usd',
  recurring: {
    interval: 'month',
    usageType: 'metered',
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
- [ ] Customer resource
- [ ] Subscription resource
- [ ] PaymentLink resource
- [ ] State management (track deployed resources)

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
