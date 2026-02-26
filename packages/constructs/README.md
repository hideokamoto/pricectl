# @pricectl/constructs

Stripe pricing resource constructs for [pricectl](https://github.com/hideokamoto/pricectl) — a kubectl-style tool for managing Stripe pricing resources with TypeScript.

## Installation

```bash
npm install @pricectl/constructs @pricectl/core
# or
pnpm add @pricectl/constructs @pricectl/core
```

## Overview

`@pricectl/constructs` provides ready-to-use TypeScript classes for Stripe pricing resources. Each construct maps directly to a Stripe API object and exposes type-safe props.

| Construct | Stripe Resource |
|-----------|----------------|
| `Product` | [Stripe Product](https://stripe.com/docs/api/products) |
| `Price` | [Stripe Price](https://stripe.com/docs/api/prices) |
| `Coupon` | [Stripe Coupon](https://stripe.com/docs/api/coupons) |

## Usage

```typescript
import { Stack } from '@pricectl/core';
import { Product, Price, Coupon } from '@pricectl/constructs';

const stack = new Stack(undefined, 'MyStack', {
  description: 'My pricing infrastructure',
});
```

---

### Product

Define a Stripe product:

```typescript
const product = new Product(stack, 'PremiumPlan', {
  name: 'Premium Plan',
  description: 'Access to all premium features',
  active: true,
});
```

#### ProductProps

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Product name displayed to customers |
| `active` | `boolean` | No (default: `true`) | Whether the product is available for purchase |
| `description` | `string` | No | Product description |
| `images` | `string[]` | No | Up to 8 image URLs |
| `metadata` | `Record<string, string>` | No | Arbitrary key-value pairs |
| `url` | `string` | No | Publicly-accessible webpage URL |
| `unitLabel` | `string` | No | Label representing units of this product |
| `statementDescriptor` | `string` | No | Text shown on customer's bank statement |
| `taxCode` | `string` | No | Stripe tax code ID |

---

### Price

Define pricing for a product (one-time, recurring, tiered, or metered):

```typescript
// One-time payment
new Price(stack, 'OneTime', {
  product,
  currency: 'usd',
  unitAmount: 4999, // $49.99
});

// Monthly subscription
new Price(stack, 'Monthly', {
  product,
  currency: 'usd',
  unitAmount: 1999, // $19.99
  recurring: { interval: 'month' },
});

// Tiered / graduated pricing
new Price(stack, 'Graduated', {
  product,
  currency: 'usd',
  recurring: { interval: 'month', usageType: 'metered' },
  tiersMode: 'graduated',
  tiers: [
    { upTo: 1000, unitAmount: 10 },
    { upTo: 10000, unitAmount: 5 },
    { upTo: 'inf', unitAmount: 2 },
  ],
});
```

#### PriceProps

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `product` | `Product \| string` | Yes | The product this price belongs to |
| `currency` | `string` | Yes | Three-letter ISO currency code (e.g. `'usd'`) |
| `unitAmount` | `number` | No | Amount in smallest currency unit (cents for USD) |
| `unitAmountDecimal` | `string` | No | Decimal amount string (alternative to `unitAmount`) |
| `active` | `boolean` | No (default: `true`) | Whether the price can be used for new purchases |
| `nickname` | `string` | No | Brief description of the price |
| `recurring` | `RecurringProps` | No | Recurring billing configuration |
| `metadata` | `Record<string, string>` | No | Arbitrary key-value pairs |
| `lookupKey` | `string` | No | Key to retrieve the price dynamically |
| `tiersMode` | `'graduated' \| 'volume'` | No | Tiering strategy |
| `tiers` | `Tier[]` | No | Pricing tiers (requires `tiersMode`) |
| `transformQuantity` | `{ divideBy: number; round: 'up' \| 'down' }` | No | Quantity transformation before billing |

#### RecurringProps

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `interval` | `'day' \| 'week' \| 'month' \| 'year'` | Yes | Billing frequency |
| `intervalCount` | `number` | No (default: `1`) | Number of intervals between billings |
| `usageType` | `'metered' \| 'licensed'` | No | How quantity per period is determined |
| `trialPeriodDays` | `number` | No | Default trial days when using `trial_from_plan` |

---

### Coupon

Create promotional discounts:

```typescript
// Percentage discount (one-time)
new Coupon(stack, 'Launch20', {
  name: 'Launch Discount',
  percentOff: 20,
  duration: 'once',
});

// Fixed amount discount (repeating for 3 months)
new Coupon(stack, 'Save10', {
  name: '$10 Off for 3 Months',
  amountOff: 1000, // $10.00
  currency: 'usd',
  duration: 'repeating',
  durationInMonths: 3,
});
```

> **Note:** Exactly one of `amountOff` or `percentOff` must be specified. When `amountOff` is used, `currency` is required. When `duration` is `'repeating'`, `durationInMonths` is required.

#### CouponProps

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `duration` | `'forever' \| 'once' \| 'repeating'` | Yes | How long the discount applies |
| `percentOff` | `number` | One of | Percentage discount (0–100) |
| `amountOff` | `number` | One of | Fixed discount amount in smallest currency unit |
| `currency` | `string` | Required with `amountOff` | ISO currency code |
| `durationInMonths` | `number` | Required when `duration='repeating'` | Number of months the coupon applies |
| `name` | `string` | No | Coupon name displayed to customers |
| `maxRedemptions` | `number` | No | Maximum total redemptions |
| `redeemBy` | `number` | No | Unix timestamp for coupon expiry |
| `metadata` | `Record<string, string>` | No | Arbitrary key-value pairs |
| `appliesTo` | `{ products?: string[] }` | No | Restrict coupon to specific product IDs |

---

## Complete Example

```typescript
import { Stack } from '@pricectl/core';
import { Product, Price, Coupon } from '@pricectl/constructs';

const stack = new Stack(undefined, 'SaaSStack', {
  description: 'SaaS subscription pricing',
});

const product = new Product(stack, 'ProPlan', {
  name: 'Pro Plan',
  description: 'Full access to all features',
});

new Price(stack, 'ProMonthly', {
  product,
  currency: 'usd',
  unitAmount: 2900, // $29/month
  recurring: { interval: 'month' },
  nickname: 'Pro Monthly',
});

new Price(stack, 'ProYearly', {
  product,
  currency: 'usd',
  unitAmount: 29000, // $290/year (~17% savings)
  recurring: { interval: 'year' },
  nickname: 'Pro Yearly',
});

new Coupon(stack, 'EarlyBird', {
  name: 'Early Bird 30% Off',
  percentOff: 30,
  duration: 'once',
  maxRedemptions: 100,
});

export default stack;
```

## License

MIT
