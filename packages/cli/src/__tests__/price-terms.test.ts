import type Stripe from 'stripe';
import { arePriceTermsEqual } from '../engine/price-comparison';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';
import { asSdkPrice } from './helpers/sdk-shapes';

const recurring = asSdkPrice(recurringPriceFixture) as unknown as Stripe.Price;
const tiered = asSdkPrice(tieredPriceFixture) as unknown as Stripe.Price;

function desiredLike(price: Stripe.Price, overrides: Partial<Stripe.PriceCreateParams> = {}): Stripe.PriceCreateParams {
  return {
    product: price.product as string,
    currency: price.currency,
    unit_amount: price.unit_amount ?? undefined,
    recurring: { interval: 'month' },
    ...overrides,
  };
}

describe('arePriceTermsEqual', () => {
  it('is true for the same terms', () => {
    expect(arePriceTermsEqual(recurring, desiredLike(recurring))).toBe(true);
  });

  it.each<[string, Partial<Stripe.PriceCreateParams>]>([
    ['active', { active: false }],
    ['nickname', { nickname: 'Pro monthly' }],
    ['lookup key', { lookup_key: 'pro_monthly' }],
    ['tax behavior', { tax_behavior: 'inclusive' }],
    ['metadata', { metadata: { team: 'billing' } }],
  ])('ignores %s, which can change on an existing price or is checked separately', (_label, overrides) => {
    expect(arePriceTermsEqual(recurring, desiredLike(recurring, overrides))).toBe(true);
  });

  it.each<[string, Partial<Stripe.PriceCreateParams>]>([
    ['amount', { unit_amount: 2000 }],
    ['currency', { currency: 'eur' }],
    ['product', { product: 'prod_other' }],
    ['interval', { recurring: { interval: 'year' } }],
    ['interval count', { recurring: { interval: 'month', interval_count: 3 } }],
  ])('is false when the %s differs, which needs a new price', (_label, overrides) => {
    expect(arePriceTermsEqual(recurring, desiredLike(recurring, overrides))).toBe(false);
  });

  it('compares tiers', () => {
    const desired: Stripe.PriceCreateParams = {
      product: tiered.product as string,
      currency: tiered.currency,
      recurring: { interval: 'month', usage_type: 'licensed' },
      billing_scheme: 'tiered',
      tiers_mode: 'graduated',
      tiers: [
        { up_to: 1000, unit_amount: 10 },
        { up_to: 'inf', unit_amount: 2, flat_amount: 100 },
      ],
    };

    expect(arePriceTermsEqual(tiered, desired)).toBe(true);
    expect(arePriceTermsEqual(tiered, { ...desired, tiers: [{ up_to: 'inf', unit_amount: 3 }] })).toBe(false);
  });
});
