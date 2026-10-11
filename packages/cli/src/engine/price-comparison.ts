import type Stripe from 'stripe';

/**
 * The properties that decide whether an existing Stripe Price matches the desired one.
 *
 * Desired params leave unset fields undefined, while Stripe returns them as null or
 * as its defaults (interval_count: 1, usage_type: 'licensed', tax_behavior: 'unspecified',
 * billing_scheme: 'per_unit', `up_to: null` for the 'inf' tier, ...). Both sides are
 * mapped into this shape with the same defaults so that only real differences remain.
 * Metadata is excluded: it is mutable and does not require a new Price.
 */
interface ComparablePrice {
  product: string | null;
  currency: string;
  unitAmountDecimal: number | null;
  active: boolean;
  nickname: string | null;
  lookupKey: string | null;
  taxBehavior: string;
  billingScheme: string;
  tiersMode: string | null;
  recurring: {
    interval: string;
    intervalCount: number;
    usageType: string;
    trialPeriodDays: number | null;
    meter: string | null;
  } | null;
  tiers: Array<{
    upTo: number | null;
    unitAmountDecimal: number | null;
    flatAmountDecimal: number | null;
  }> | null;
  transformQuantity: { divideBy: number; round: string } | null;
}

/** Decimal amounts arrive as strings, numbers or (since stripe-node v21) Stripe.Decimal objects. */
function toNumber(decimal: string | number | Stripe.Decimal | null | undefined): number | null {
  return decimal === null || decimal === undefined ? null : Number(String(decimal));
}

/** The product ID of a price, whether the product is a string or an expanded object. */
function productId(product: string | { id: string } | null | undefined): string | null {
  if (product === null || product === undefined) return null;
  return typeof product === 'string' ? product : product.id;
}

/** Map desired price params to the comparable shape, filling in Stripe defaults. */
function fromDesired(desired: Stripe.PriceCreateParams): ComparablePrice {
  return {
    product: productId(desired.product),
    currency: desired.currency,
    unitAmountDecimal: toNumber(desired.unit_amount_decimal ?? desired.unit_amount),
    active: desired.active ?? true,
    nickname: desired.nickname ?? null,
    lookupKey: desired.lookup_key ?? null,
    taxBehavior: desired.tax_behavior ?? 'unspecified',
    billingScheme: desired.billing_scheme ?? 'per_unit',
    tiersMode: desired.tiers_mode ?? null,
    recurring: desired.recurring
      ? {
          interval: desired.recurring.interval,
          intervalCount: desired.recurring.interval_count ?? 1,
          usageType: desired.recurring.usage_type ?? 'licensed',
          trialPeriodDays: desired.recurring.trial_period_days ?? null,
          meter: desired.recurring.meter ?? null,
        }
      : null,
    tiers: desired.tiers
      ? desired.tiers.map((tier) => ({
          upTo: tier.up_to === 'inf' ? null : tier.up_to,
          unitAmountDecimal: toNumber(tier.unit_amount_decimal ?? tier.unit_amount),
          flatAmountDecimal: toNumber(tier.flat_amount_decimal ?? tier.flat_amount),
        }))
      : null,
    transformQuantity: desired.transform_quantity
      ? { divideBy: desired.transform_quantity.divide_by, round: desired.transform_quantity.round }
      : null,
  };
}

/** Map a Stripe price to the comparable shape. */
function fromStripe(existing: Stripe.Price): ComparablePrice {
  return {
    product: productId(existing.product as string | { id: string }),
    currency: existing.currency,
    unitAmountDecimal: toNumber(existing.unit_amount_decimal),
    active: existing.active,
    nickname: existing.nickname ?? null,
    lookupKey: existing.lookup_key ?? null,
    taxBehavior: existing.tax_behavior ?? 'unspecified',
    billingScheme: existing.billing_scheme,
    tiersMode: existing.tiers_mode ?? null,
    recurring: existing.recurring
      ? {
          interval: existing.recurring.interval,
          intervalCount: existing.recurring.interval_count,
          usageType: existing.recurring.usage_type,
          trialPeriodDays: existing.recurring.trial_period_days ?? null,
          meter: (existing.recurring as { meter?: string | null }).meter ?? null,
        }
      : null,
    tiers: existing.tiers
      ? existing.tiers.map((tier) => ({
          upTo: tier.up_to,
          unitAmountDecimal: toNumber(tier.unit_amount_decimal),
          flatAmountDecimal: toNumber(tier.flat_amount_decimal),
        }))
      : null,
    transformQuantity: existing.transform_quantity
      ? { divideBy: existing.transform_quantity.divide_by, round: existing.transform_quantity.round }
      : null,
  };
}

/**
 * Whether an existing Stripe Price already satisfies the desired create params.
 * The existing price must be fetched with `expand: ['tiers']`; Stripe omits tiers otherwise.
 */
export function isPriceEquivalent(existing: Stripe.Price, desired: Stripe.PriceCreateParams): boolean {
  return JSON.stringify(fromStripe(existing)) === JSON.stringify(fromDesired(desired));
}
