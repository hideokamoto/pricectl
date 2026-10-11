import { Stack } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import { StripeDeployer } from '../engine/deployer';
import { StateManager } from '../engine/state';
import { FakeStripe } from './helpers/fake-stripe';
import { InMemoryStateStore } from './helpers/in-memory-state-store';
import productFixture from './fixtures/stripe/product.json';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import lookupPriceFixture from './fixtures/stripe/price-one-time-lookup.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';
import couponFixture from './fixtures/stripe/coupon.json';
import featureFixture from './fixtures/stripe/feature.json';
import meterFixture from './fixtures/stripe/meter.json';

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
        lookupKey: lookupPriceFixture.lookup_key,
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

  describe('Price whose metadata differs from Stripe', () => {
    it('updates the metadata in place instead of recreating the price', async () => {
      mockFakeStripe.seed('prices', recurringPriceFixture);
      const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy', tags: { team: 'billing' } });
      new Price(stack, 'FxMonthly', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 1000,
        recurring: { interval: 'month' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0]).toMatchObject({ status: 'updated', physicalId: recurringPriceFixture.id });
      expect(mockFakeStripe.pricesFor('FxMonthly')).toEqual([
        expect.objectContaining({ metadata: expect.objectContaining({ team: 'billing', pricectl_id: 'FxMonthly' }) }),
      ]);
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
        lookupKey: lookupPriceFixture.lookup_key,
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      const prices = mockFakeStripe.pricesFor('FxLookup');
      const replacement = prices.find((p) => p.id !== lookupPriceFixture.id);
      const original = prices.find((p) => p.id === lookupPriceFixture.id);
      expect(replacement).toMatchObject({ active: true, unit_amount: 600, lookup_key: lookupPriceFixture.lookup_key });
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
        lookupKey: lookupPriceFixture.lookup_key,
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([expect.objectContaining({ id: 'FxLookup', error: 'Stripe is unavailable' })]);
      const prices = mockFakeStripe.pricesFor('FxLookup');
      expect(prices.filter((p) => p.active)).toEqual([
        expect.objectContaining({ id: lookupPriceFixture.id, lookup_key: lookupPriceFixture.lookup_key }),
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

  describe('Price that bills through a Meter', () => {
    function createMeteredStack(): Stack {
      const stack = createStack();
      const meter = new Meter(stack, 'NewMeter', {
        displayName: 'New meter',
        eventName: 'new_event',
        defaultAggregation: { formula: 'count' },
      });
      new Price(stack, 'NewUsage', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 5,
        recurring: { interval: 'month', usageType: 'metered', meter },
      });
      return stack;
    }

    it('creates the price with the Stripe ID of the meter', async () => {
      const result = await new StripeDeployer('sk_test_dummy').deploy(createMeteredStack().synth());

      expect(result.errors).toEqual([]);
      const meterId = result.deployed.find((d) => d.id === 'NewMeter')?.physicalId;
      expect(mockFakeStripe.pricesFor('NewUsage')).toEqual([
        expect.objectContaining({ recurring: expect.objectContaining({ meter: meterId }) }),
      ]);
    });

    it('keeps the metered price unchanged on the next deploy', async () => {
      await new StripeDeployer('sk_test_dummy').deploy(createMeteredStack().synth());

      const second = await new StripeDeployer('sk_test_dummy').deploy(createMeteredStack().synth());

      expect(second.errors).toEqual([]);
      expect(second.deployed.map((d) => d.status)).toEqual(['unchanged', 'unchanged']);
    });
  });

  describe('Product that grants entitlement features', () => {
    function createStackWithFeatures(featureIds: string[]): Stack {
      const stack = createStack();
      const features = featureIds.map((id) => new EntitlementFeature(stack, id, { name: id, lookupKey: id.toLowerCase() }));
      new Product(stack, 'NewProd', { name: 'New product', features });
      return stack;
    }

    function attachedLookupKeys(): string[] {
      const productId = mockFakeStripe.productsFor('NewProd')[0].id;
      return mockFakeStripe
        .featuresOf(productId)
        .map((id) => mockFakeStripe.featureStore.get(id)?.lookup_key)
        .sort();
    }

    it('attaches the features to the product', async () => {
      const result = await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support', 'Sso']).synth());

      expect(result.errors).toEqual([]);
      expect(attachedLookupKeys()).toEqual(['sso', 'support']);
    });

    it('leaves features attached outside pricectl alone when the product does not set features', async () => {
      const outside = await mockFakeStripe.entitlements.features.create({ name: 'Outside', lookup_key: 'outside' });
      await mockFakeStripe.products.createFeature(PRODUCT_ID, { entitlement_feature: outside.id });
      const stack = createStack();
      new Product(stack, 'FxProd', { name: 'Renamed fixture product', physicalId: PRODUCT_ID });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0].status).toBe('updated');
      expect(mockFakeStripe.featuresOf(PRODUCT_ID)).toEqual([outside.id]);
    });

    it('attaches the features on the next deploy when attaching failed after the product was created', async () => {
      mockFakeStripe.failNext('products.createFeature', { message: 'Stripe is unavailable' });
      const first = await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support']).synth());
      expect(first.errors).toHaveLength(1);

      const second = await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support']).synth());

      expect(second.errors).toEqual([]);
      expect(attachedLookupKeys()).toEqual(['support']);
    });

    it('re-attaches a feature that was detached outside pricectl', async () => {
      await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support']).synth());
      const productId = mockFakeStripe.productsFor('NewProd')[0].id;
      mockFakeStripe.productFeatureStore.set(productId, []);

      const result = await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support']).synth());

      expect(result.deployed.find((d) => d.id === 'NewProd')?.status).toBe('updated');
      expect(attachedLookupKeys()).toEqual(['support']);
    });

    it('detaches a feature that was removed from the definition', async () => {
      await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support', 'Sso']).synth());

      const result = await new StripeDeployer('sk_test_dummy').deploy(createStackWithFeatures(['Support']).synth());

      expect(result.errors).toEqual([]);
      expect(attachedLookupKeys()).toEqual(['support']);
    });
  });

  describe('Product with a physicalId', () => {
    it('adopts the given existing product instead of creating a new one', async () => {
      mockFakeStripe.seed('products', { ...productFixture, id: 'prod_unmanaged', metadata: {} });
      const stack = createStack();
      new Product(stack, 'Adopted', { name: 'Adopted product', physicalId: 'prod_unmanaged' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0]).toMatchObject({ status: 'updated', physicalId: 'prod_unmanaged' });
      expect(mockFakeStripe.productsFor('Adopted')).toEqual([
        expect.objectContaining({ id: 'prod_unmanaged', name: 'Adopted product' }),
      ]);
    });
  });

  describe('Meter and EntitlementFeature with a physicalId', () => {
    it('uses the meter named by physicalId even when another meter has the same event name', async () => {
      mockFakeStripe.seed('meters', { ...meterFixture, id: 'mtr_other' });
      mockFakeStripe.seed('meters', meterFixture);
      const stack = createStack();
      new Meter(stack, 'Adopted', {
        physicalId: meterFixture.id,
        displayName: 'Renamed meter',
        eventName: meterFixture.event_name,
        defaultAggregation: { formula: 'count' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0]).toMatchObject({ status: 'updated', physicalId: meterFixture.id });
      expect(mockFakeStripe.meterStore.get(meterFixture.id)?.display_name).toBe('Renamed meter');
    });

    it('reports an error when the meter named by physicalId has a different event name', async () => {
      mockFakeStripe.seed('meters', meterFixture);
      const stack = createStack();
      new Meter(stack, 'Adopted', {
        physicalId: meterFixture.id,
        displayName: 'Meter',
        eventName: 'another_event',
        defaultAggregation: { formula: 'count' },
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors[0].error).toContain('event_name');
      expect(mockFakeStripe.meterStore.size).toBe(1);
    });

    it('uses the feature named by physicalId', async () => {
      mockFakeStripe.seed('features', featureFixture);
      const stack = createStack();
      new EntitlementFeature(stack, 'Adopted', {
        physicalId: featureFixture.id,
        name: 'Renamed feature',
        lookupKey: featureFixture.lookup_key,
      });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed[0]).toMatchObject({ status: 'updated', physicalId: featureFixture.id });
      expect(mockFakeStripe.featureStore.get(featureFixture.id)?.name).toBe('Renamed feature');
    });

    it('skips a feature named by physicalId that destroy already deactivated', async () => {
      mockFakeStripe.seed('features', featureFixture);
      const stack = createStack();
      new EntitlementFeature(stack, 'Adopted', { physicalId: featureFixture.id, name: 'Feature', lookupKey: featureFixture.lookup_key });
      await new StripeDeployer('sk_test_dummy').destroy(stack.synth());

      const second = await new StripeDeployer('sk_test_dummy').destroy(stack.synth());

      expect(second.errors).toEqual([]);
      expect(second.destroyed).toEqual([]);
    });

    it('reports an error when the feature named by physicalId has a different lookup key', async () => {
      mockFakeStripe.seed('features', featureFixture);
      const stack = createStack();
      new EntitlementFeature(stack, 'Adopted', { physicalId: featureFixture.id, name: 'Feature', lookupKey: 'another_key' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors[0].error).toContain('lookup_key');
      expect(mockFakeStripe.featureStore.size).toBe(1);
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
      new Coupon(stack, couponFixture.id, { percentOff: 10, duration: 'once', name: 'Fx coupon' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0].status).toBe('unchanged');
    });

    it('updates the name of an existing coupon', async () => {
      const stack = createStack();
      new Coupon(stack, couponFixture.id, { percentOff: 10, duration: 'once', name: 'Fx coupon B' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.errors).toEqual([]);
      expect(result.deployed[0].status).toBe('updated');
      expect(mockFakeStripe.couponStore.get(couponFixture.id)?.name).toBe('Fx coupon B');
    });

    it('reports an error instead of silently ignoring a change Stripe cannot apply to a coupon', async () => {
      const stack = createStack();
      new Coupon(stack, couponFixture.id, { percentOff: 20, duration: 'once', name: 'Fx coupon' });

      const result = await new StripeDeployer('sk_test_dummy').deploy(stack.synth());

      expect(result.deployed).toEqual([]);
      expect(result.errors[0].error).toContain('percent_off');
      expect(mockFakeStripe.couponStore.get(couponFixture.id)?.percent_off).toBe(10);
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

    it('can be run again after everything was destroyed', async () => {
      const stack = createStack();
      new Meter(stack, 'NewMeter', { displayName: 'New meter', eventName: 'new_event', defaultAggregation: { formula: 'count' } });
      const deployer = new StripeDeployer('sk_test_dummy');
      await deployer.deploy(stack.synth());
      await deployer.destroy(stack.synth());

      const second = await new StripeDeployer('sk_test_dummy').destroy(stack.synth());

      expect(second.errors).toEqual([]);
      expect(second.destroyed).toEqual([]);
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

  describe('resources removed from the definition', () => {
    /** State kept in memory, so the test does not touch the filesystem. */
    function inMemoryState(): StateManager {
      return new StateManager(new InMemoryStateStore());
    }

    function createPricingStack(withYearly: boolean): Stack {
      const stack = createStack();
      const product = new Product(stack, 'NewProd', { name: 'New product' });
      new Price(stack, 'NewMonthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } });
      if (withYearly) {
        new Price(stack, 'NewYearly', { product, currency: 'usd', unitAmount: 10000, recurring: { interval: 'year' } });
      }
      return stack;
    }

    it('deactivates on deploy a price that was removed from the definition', async () => {
      const state = inMemoryState();
      await new StripeDeployer('sk_test_dummy', undefined, state).deploy(createPricingStack(true).synth());

      const result = await new StripeDeployer('sk_test_dummy', undefined, state).deploy(createPricingStack(false).synth());

      expect(result.errors).toEqual([]);
      expect(result.removed).toEqual([{ id: 'NewYearly', type: 'Stripe::Price', status: 'deactivated' }]);
      expect(mockFakeStripe.pricesFor('NewYearly')).toEqual([expect.objectContaining({ active: false })]);
      expect(state.getResource('FxStack', 'NewYearly')).toBeUndefined();
    });

    it('keeps a resource that is no longer defined but still referred to by its Stripe ID, and stops tracking it', async () => {
      const state = inMemoryState();
      const v1 = createStack();
      const meter = new Meter(v1, 'ApiCalls', { displayName: 'API calls', eventName: 'api_call', defaultAggregation: { formula: 'count' } });
      new Price(v1, 'Usage', { product: PRODUCT_ID, currency: 'usd', unitAmount: 5, recurring: { interval: 'month', usageType: 'metered', meter } });
      const first = await new StripeDeployer('sk_test_dummy', undefined, state).deploy(v1.synth());
      const meterId = first.deployed.find((d) => d.id === 'ApiCalls')?.physicalId as string;

      const v2 = createStack();
      new Price(v2, 'Usage', { product: PRODUCT_ID, currency: 'usd', unitAmount: 5, recurring: { interval: 'month', usageType: 'metered', meter: meterId } });
      const result = await new StripeDeployer('sk_test_dummy', undefined, state).deploy(v2.synth());

      expect(result.errors).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(mockFakeStripe.meterStore.get(meterId)?.status).toBe('active');
      expect(state.getResource('FxStack', 'ApiCalls')).toBeUndefined();
    });

    it('keeps resources that are no longer defined when deploying the defined ones failed', async () => {
      const state = inMemoryState();
      const v1 = createStack();
      new Price(v1, 'Monthly', { product: PRODUCT_ID, currency: 'usd', unitAmount: 1000, lookupKey: 'pro_monthly' });
      await new StripeDeployer('sk_test_dummy', undefined, state).deploy(v1.synth());

      // Renaming the logical ID makes the old price an orphan, and the new one cannot take its lookup key
      const v2 = createStack();
      new Price(v2, 'MonthlyV2', { product: PRODUCT_ID, currency: 'usd', unitAmount: 1000, lookupKey: 'pro_monthly' });
      const result = await new StripeDeployer('sk_test_dummy', undefined, state).deploy(v2.synth());

      expect(result.errors).toEqual([expect.objectContaining({ id: 'MonthlyV2' })]);
      expect(result.removed).toEqual([]);
      expect(result.removalSkipped).toBe(true);
      expect(mockFakeStripe.pricesFor('Monthly')).toEqual([expect.objectContaining({ active: true })]);
      expect(state.getResource('FxStack', 'Monthly')).toBeDefined();
    });

    it('also cleans up on destroy a resource that is only left in the state file', async () => {
      const state = inMemoryState();
      const stack = createStack();
      new Coupon(stack, 'PricectlOldCoupon', { percentOff: 5, duration: 'once' });
      await new StripeDeployer('sk_test_dummy', undefined, state).deploy(stack.synth());

      const result = await new StripeDeployer('sk_test_dummy', undefined, state).destroy(createStack().synth());

      expect(result.errors).toEqual([]);
      expect(result.destroyed).toEqual([{ id: 'PricectlOldCoupon', type: 'Stripe::Coupon', status: 'deleted' }]);
      expect(mockFakeStripe.couponStore.has('PricectlOldCoupon')).toBe(false);
    });
  });
});

