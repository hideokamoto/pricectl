import { Stack } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import { StripeDeployer } from '../engine/deployer';
import { FakeStripe } from './helpers/fake-stripe';
import productFixture from './fixtures/stripe/product.json';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import lookupPriceFixture from './fixtures/stripe/price-one-time-lookup.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';
import couponFixture from './fixtures/stripe/coupon.json';

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

    it('moves the lookup key to the replacement price and deactivates the old one', async () => {
      mockFakeStripe.seed('prices', lookupPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxLookup', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 600,
        lookupKey: 'pricectl_fx_lookup',
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      const prices = mockFakeStripe.pricesFor('FxLookup');
      const replacement = prices.find((p) => p.id !== lookupPriceFixture.id);
      const original = prices.find((p) => p.id === lookupPriceFixture.id);
      expect(replacement).toMatchObject({ active: true, unit_amount: 600, lookup_key: 'pricectl_fx_lookup' });
      expect(original).toMatchObject({ active: false, lookup_key: null });
    });

    it('restores the old price when deactivating it fails after the replacement was created', async () => {
      mockFakeStripe.seed('prices', lookupPriceFixture);
      // The first prices.update is the deactivation of the old price
      mockFakeStripe.failNext('prices.update', { message: 'Stripe is unavailable' });
      const stack = createStack();
      new Price(stack, 'FxLookup', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 600,
        lookupKey: 'pricectl_fx_lookup',
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([expect.objectContaining({ id: 'FxLookup', error: 'Stripe is unavailable' })]);
      const prices = mockFakeStripe.pricesFor('FxLookup');
      expect(prices.filter((p) => p.active)).toEqual([
        expect.objectContaining({ id: lookupPriceFixture.id, lookup_key: 'pricectl_fx_lookup' }),
      ]);
    });

    it('leaves the old price active when creating the replacement fails', async () => {
      mockFakeStripe.seed('prices', recurringPriceFixture);
      mockFakeStripe.failNext('prices.create', { message: 'Stripe is unavailable' });
      const stack = createStack();
      new Price(stack, 'FxMonthly', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 1200,
        recurring: { interval: 'month' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toHaveLength(1);
      expect(mockFakeStripe.pricesFor('FxMonthly')).toEqual([
        expect.objectContaining({ id: recurringPriceFixture.id, active: true }),
      ]);
    });
  });

  describe('deploying without a state file', () => {
    it('does not duplicate resources that Stripe search has not indexed yet', async () => {
      const stack = createStack();
      const product = new Product(stack, 'NewProd', { name: 'New product' });
      new Price(stack, 'NewMonthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } });

      await new StripeDeployer('sk_test_dummy').deploy(stack.synth());
      const second = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(second.errors).toEqual([]);
      expect(second.deployed.map((d) => d.status)).toEqual(['unchanged', 'unchanged']);
      expect(mockFakeStripe.productsFor('NewProd')).toHaveLength(1);
      expect(mockFakeStripe.pricesFor('NewMonthly')).toHaveLength(1);
    });

    it('compares against the active price when replaced prices share the logical ID', async () => {
      mockFakeStripe.seed('prices', {
        ...recurringPriceFixture,
        id: 'price_replaced',
        active: false,
        unit_amount: 900,
        unit_amount_decimal: '900',
      });
      mockFakeStripe.seed('prices', recurringPriceFixture);
      const stack = createStack();
      new Price(stack, 'FxMonthly', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 1000,
        recurring: { interval: 'month' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0]).toMatchObject({ status: 'unchanged', physicalId: recurringPriceFixture.id });
      expect(mockFakeStripe.pricesFor('FxMonthly')).toHaveLength(2);
    });
  });

  describe('Coupon', () => {
    beforeEach(() => {
      mockFakeStripe.seed('coupons', couponFixture);
    });

    it('reports a coupon with the same definition as unchanged', async () => {
      const stack = createStack();
      new Coupon(stack, 'PricectlFxCoupon', { percentOff: 10, duration: 'once', name: 'Fx coupon' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0].status).toBe('unchanged');
    });

    it('updates the name of an existing coupon', async () => {
      const stack = createStack();
      new Coupon(stack, 'PricectlFxCoupon', { percentOff: 10, duration: 'once', name: 'Fx coupon B' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0].status).toBe('updated');
      expect(mockFakeStripe.couponStore.get('PricectlFxCoupon')?.name).toBe('Fx coupon B');
    });

    it('reports an error instead of silently ignoring a change Stripe cannot apply to a coupon', async () => {
      const stack = createStack();
      new Coupon(stack, 'PricectlFxCoupon', { percentOff: 20, duration: 'once', name: 'Fx coupon' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed).toEqual([]);
      expect(result.errors[0].error).toContain('percent_off');
      expect(mockFakeStripe.couponStore.get('PricectlFxCoupon')?.percent_off).toBe(10);
    });
  });

  describe('destroy', () => {
    it('archives a product that still has prices, because Stripe refuses to delete it', async () => {
      const stack = createStack();
      const product = new Product(stack, 'NewProd', { name: 'New product' });
      new Price(stack, 'NewMonthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } });
      const deployer = new StripeDeployer('sk_test_dummy');
      await deployer.deploy(stack.synth());

      const result = await deployer.destroy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.destroyed).toContainEqual({ id: 'NewProd', type: 'Stripe::Product', status: 'deactivated' });
      expect(mockFakeStripe.productsFor('NewProd')).toEqual([expect.objectContaining({ active: false })]);
    });

    it('reactivates a product archived by destroy on the next deploy', async () => {
      const stack = createStack();
      const product = new Product(stack, 'NewProd', { name: 'New product' });
      new Price(stack, 'NewMonthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } });
      const deployer = new StripeDeployer('sk_test_dummy');
      await deployer.deploy(stack.synth());
      await deployer.destroy(stack.synth());

      const redeploy = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(redeploy.errors).toEqual([]);
      expect(mockFakeStripe.productsFor('NewProd')).toEqual([expect.objectContaining({ active: true })]);
    });
  });

  describe('EntitlementFeature and Meter', () => {
    function createFeatureAndMeterStack(): Stack {
      const stack = createStack();
      new EntitlementFeature(stack, 'NewFeature', { name: 'New feature', lookupKey: 'new_feature' });
      new Meter(stack, 'NewMeter', {
        displayName: 'New meter',
        eventName: 'new_event',
        defaultAggregation: { formula: 'count' },
      });
      return stack;
    }

    it('reports a feature and a meter that did not change as unchanged', async () => {
      const stack = createFeatureAndMeterStack();
      await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      const second = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(second.errors).toEqual([]);
      expect(second.deployed.map((d) => d.status)).toEqual(['unchanged', 'unchanged']);
    });

    it('makes a destroyed feature and meter usable again on the next deploy', async () => {
      const stack = createFeatureAndMeterStack();
      const deployer = new StripeDeployer('sk_test_dummy');
      await deployer.deploy(stack.synth());
      await deployer.destroy(stack.synth());

      const redeploy = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(redeploy.errors).toEqual([]);
      const features = [...mockFakeStripe.featureStore.values()].filter((f) => f.lookup_key === 'new_feature');
      expect(features.filter((f) => f.active)).toHaveLength(1);
      const meters = [...mockFakeStripe.meterStore.values()].filter((m) => m.event_name === 'new_event');
      expect(meters.map((m) => m.status)).toEqual(['active']);
    });
  });
});

