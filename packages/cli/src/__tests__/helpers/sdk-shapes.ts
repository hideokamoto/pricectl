/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as StripeModule from 'stripe';

// Tests that replace the Stripe client with jest.mock('stripe') still need the real Decimal
const { Decimal } = jest.requireActual<typeof StripeModule>('stripe');

/**
 * Convert a raw Stripe price (as recorded in the fixtures) into the shape stripe-node
 * returns it in: since v21 the SDK turns decimal_string fields into Stripe.Decimal objects.
 */
export function asSdkPrice<T extends Record<string, any>>(raw: T): T {
  const toDecimal = (value: unknown) => (typeof value === 'string' ? Decimal.from(value) : value);
  const price: Record<string, any> = { ...raw, unit_amount_decimal: toDecimal(raw.unit_amount_decimal) };
  if (Array.isArray(raw.tiers)) {
    price.tiers = raw.tiers.map((tier: Record<string, any>) => ({
      ...tier,
      unit_amount_decimal: toDecimal(tier.unit_amount_decimal),
      flat_amount_decimal: toDecimal(tier.flat_amount_decimal),
    }));
  }
  return price as T;
}
