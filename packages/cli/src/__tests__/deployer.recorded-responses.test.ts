import { Stack } from '@pricectl/core';
import { Price } from '@pricectl/constructs';
import { StripeDeployer } from '../engine/deployer';
import { FakeStripe } from './helpers/fake-stripe';
import productFixture from './fixtures/stripe/product.json';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import lookupPriceFixture from './fixtures/stripe/price-one-time-lookup.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';

let mockFakeStripe: FakeStripe;
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockFakeStripe));

const PRODUCT_ID = productFixture.id;

function createStack(): Stack {
  return new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
}

describe('StripeDeployer against recorded Stripe responses', () => {
  beforeEach(() => {
    mockFakeStripe = new FakeStripe();
    mockFakeStripe.seed('products', productFixture);
  });

  describe('Price that already exists in Stripe with the same definition', () => {
    it('keeps a recurring price unchanged instead of recreating it', async () => {
      mockFakeStripe.seed('prices', recurringPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxMonthly', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 1000,
        recurring: { interval: 'month' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0]).toMatchObject({ status: 'unchanged', physicalId: recurringPriceFixture.id });
      expect(mockFakeStripe.pricesFor('FxMonthly')).toHaveLength(1);
    });

    it('keeps a one-time price with a lookup key unchanged instead of recreating it', async () => {
      mockFakeStripe.seed('prices', lookupPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxLookup', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 500,
        lookupKey: 'pricectl_fx_lookup',
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0]).toMatchObject({ status: 'unchanged', physicalId: lookupPriceFixture.id });
      expect(mockFakeStripe.pricesFor('FxLookup')).toHaveLength(1);
    });

    it('keeps a tiered price unchanged even though Stripe omits tiers unless expanded', async () => {
      mockFakeStripe.seed('prices', tieredPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxTiered', {
        product: PRODUCT_ID,
        currency: 'usd',
        recurring: { interval: 'month', usageType: 'licensed' },
        tiersMode: 'graduated',
        tiers: [
          { upTo: 1000, unitAmount: 10 },
          { upTo: 'inf', unitAmount: 2, flatAmount: 100 },
        ],
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0]).toMatchObject({ status: 'unchanged', physicalId: tieredPriceFixture.id });
      expect(mockFakeStripe.pricesFor('FxTiered')).toHaveLength(1);
    });
  });

  describe('Price whose definition differs from Stripe', () => {
    it('creates a new price when the unit amount changed', async () => {
      mockFakeStripe.seed('prices', recurringPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxMonthly', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 1200,
        recurring: { interval: 'month' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0].status).toBe('created');
      const active = mockFakeStripe.pricesFor('FxMonthly').filter((p) => p.active);
      expect(active.map((p) => p.unit_amount)).toEqual([1200]);
    });

    it('creates a new price when a tier changed', async () => {
      mockFakeStripe.seed('prices', tieredPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxTiered', {
        product: PRODUCT_ID,
        currency: 'usd',
        recurring: { interval: 'month', usageType: 'licensed' },
        tiersMode: 'graduated',
        tiers: [
          { upTo: 1000, unitAmount: 10 },
          { upTo: 'inf', unitAmount: 1, flatAmount: 100 },
        ],
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0].status).toBe('created');
    });
  });
});
