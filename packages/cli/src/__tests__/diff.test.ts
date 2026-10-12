import { Stack } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import type Stripe from 'stripe';
import { StackManifest } from '@pricectl/core';
import { currentResource } from '../engine/current';
import { diffResource } from '../engine/diff';
import { emptyLock, nextLock } from '../engine/lock';
import { readObservations } from '../engine/read-stripe';
import { indexResources, resolveReferences } from '../engine/refs';
import { FakeStripe } from './helpers/fake-stripe';
import { asSdkPrice } from './helpers/sdk-shapes';
import productFixture from './fixtures/stripe/product.json';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import lookupPriceFixture from './fixtures/stripe/price-one-time-lookup.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';
import couponFixture from './fixtures/stripe/coupon.json';
import featureFixture from './fixtures/stripe/feature.json';
import meterFixture from './fixtures/stripe/meter.json';
import meteredPriceFixture from './fixtures/stripe/price-metered.json';

const PRODUCT_ID = productFixture.id;

function createStack(): Stack {
  return new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
}

function synthesizedProperties(stack: Stack, logicalId: string): Record<string, unknown> {
  const resource = stack.synth().resources.find((r) => r.id === logicalId);
  if (!resource) throw new Error(`resource ${logicalId} was not synthesized`);
  return resource.properties;
}

/** Product as Stripe returns it after a deploy, which records a properties hash in metadata. */
const deployedProductFixture = {
  ...productFixture,
  metadata: { ...productFixture.metadata, pricectl_properties_hash: '640b18caf51c479d' },
};

describe('diffResource', () => {
  describe('resources whose definition matches what Stripe returns', () => {
    it.each([
      [
        'product',
        'Stripe::Product',
        'FxProd',
        (stack: Stack) => new Product(stack, 'FxProd', { name: 'pricectl fixture product', description: 'fixture' }),
        deployedProductFixture,
      ],
      [
        'recurring price',
        'Stripe::Price',
        'FxMonthly',
        (stack: Stack) =>
          new Price(stack, 'FxMonthly', {
            product: PRODUCT_ID,
            currency: 'usd',
            unitAmount: 1000,
            recurring: { interval: 'month' },
          }),
        asSdkPrice(recurringPriceFixture),
      ],
      [
        'one-time price with a lookup key',
        'Stripe::Price',
        'FxLookup',
        (stack: Stack) =>
          new Price(stack, 'FxLookup', {
            product: PRODUCT_ID,
            currency: 'usd',
            unitAmount: 500,
            lookupKey: lookupPriceFixture.lookup_key,
          }),
        asSdkPrice(lookupPriceFixture),
      ],
      [
        'tiered price',
        'Stripe::Price',
        'FxTiered',
        (stack: Stack) =>
          new Price(stack, 'FxTiered', {
            product: PRODUCT_ID,
            currency: 'usd',
            recurring: { interval: 'month', usageType: 'licensed' },
            tiersMode: 'graduated',
            tiers: [
              { upTo: 1000, unitAmount: 10 },
              { upTo: 'inf', unitAmount: 2, flatAmount: 100 },
            ],
          }),
        asSdkPrice(tieredPriceFixture),
      ],
      [
        'coupon',
        'Stripe::Coupon',
        couponFixture.id,
        (stack: Stack) => new Coupon(stack, couponFixture.id, { percentOff: 10, duration: 'once', name: 'Fx coupon' }),
        couponFixture,
      ],
      [
        'entitlement feature',
        'Stripe::EntitlementFeature',
        'FxFeature',
        (stack: Stack) => new EntitlementFeature(stack, 'FxFeature', { name: 'Fx feature', lookupKey: featureFixture.lookup_key }),
        featureFixture,
      ],
      [
        'meter',
        'Stripe::BillingMeter',
        'FxMeter',
        (stack: Stack) =>
          new Meter(stack, 'FxMeter', {
            displayName: 'Fx meter',
            eventName: meterFixture.event_name,
            defaultAggregation: { formula: 'count' },
          }),
        meterFixture,
      ],
    ])('reports no change for a %s', (_label, type, logicalId, define, current) => {
      const stack = createStack();
      define(stack);

      const diff = diffResource(type, synthesizedProperties(stack, logicalId), current as never);

      expect(diff).toMatchObject({ changed: false });
    });
  });

  describe('metered price', () => {
    it('reports no change when the price bills through the same meter', () => {
      const diff = diffResource(
        'Stripe::Price',
        {
          product: meteredPriceFixture.product,
          currency: 'usd',
          active: true,
          unit_amount: 5,
          metadata: { team: 'billing' },
          recurring: { interval: 'month', usage_type: 'metered', meter: meteredPriceFixture.recurring.meter },
        },
        asSdkPrice(meteredPriceFixture) as never,
      );

      expect(diff.changed).toBe(false);
    });
  });

  describe('product features', () => {
    it('reports no change when the same features are attached, in any order', () => {
      const diff = diffResource(
        'Stripe::Product',
        { name: 'pricectl fixture product', description: 'fixture', active: true, features: ['feat_b', 'feat_a'] },
        { ...deployedProductFixture, features: ['feat_a', 'feat_b'] } as never,
      );

      expect(diff.changed).toBe(false);
    });

    it('ignores attached features when the product does not set features', () => {
      const diff = diffResource(
        'Stripe::Product',
        { name: 'pricectl fixture product', description: 'fixture', active: true },
        { ...deployedProductFixture, features: ['feat_attached_elsewhere'] } as never,
      );

      expect(diff.changed).toBe(false);
    });

    it('reports a feature that is not attached yet as a change', () => {
      const diff = diffResource(
        'Stripe::Product',
        { name: 'pricectl fixture product', description: 'fixture', active: true, features: ['feat_a'] },
        { ...deployedProductFixture, features: [] } as never,
      );

      expect(diff.changed).toBe(true);
    });
  });

  describe('resources whose definition differs from Stripe', () => {
    it('reports a changed product name as a change', () => {
      const stack = createStack();
      new Product(stack, 'FxProd', { name: 'Renamed product', description: 'fixture' });

      const diff = diffResource('Stripe::Product', synthesizedProperties(stack, 'FxProd'), deployedProductFixture as never);

      expect(diff.changed).toBe(true);
      expect(diff.desired).toContain('Renamed product');
      expect(diff.current).toContain('pricectl fixture product');
    });

    it('reports a changed tier as a change', () => {
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

      const diff = diffResource('Stripe::Price', synthesizedProperties(stack, 'FxTiered'), asSdkPrice(tieredPriceFixture) as never);

      expect(diff.changed).toBe(true);
    });

    it('reports a changed tax behavior as a change', () => {
      const stack = createStack();
      new Price(stack, 'FxLookup', {
        product: PRODUCT_ID,
        currency: 'usd',
        unitAmount: 500,
        lookupKey: lookupPriceFixture.lookup_key,
        taxBehavior: 'inclusive',
      });

      const diff = diffResource('Stripe::Price', synthesizedProperties(stack, 'FxLookup'), asSdkPrice(lookupPriceFixture) as never);

      expect(diff.changed).toBe(true);
    });
  });
});

describe('resolveReferences', () => {
  const asStripe = (fake: FakeStripe) => fake as unknown as Stripe;

  async function observed(fake: FakeStripe, manifest: StackManifest) {
    return readObservations(asStripe(fake), manifest, nextLock(manifest, emptyLock()));
  }

  it('resolves the product of a price to the ID pricectl derived for it, and the meter to its Stripe ID', async () => {
    const fake = new FakeStripe();
    const meter = await fake.billing.meters.create({ display_name: 'Calls', event_name: 'api_calls', default_aggregation: { formula: 'count' } });
    const manifest = (() => {
      const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
      const m = new Meter(stack, 'NewMeter', { displayName: 'Calls', eventName: 'api_calls', defaultAggregation: { formula: 'count' } });
      const product = new Product(stack, 'NewProd', { name: 'Widget' });
      new Price(stack, 'Usage', { product, currency: 'usd', recurring: { interval: 'month', usageType: 'metered', meter: m } });
      return stack.synth();
    })();
    const price = manifest.resources.find((r) => r.id === 'Usage')!;

    const resolved = resolveReferences(price, indexResources(manifest), await observed(fake, manifest));

    expect(resolved).toMatchObject({ product: 'FxStack_NewProd', recurring: { meter: meter.id } });
  });

  it('resolves the entitlement features of a product to their Stripe IDs, leaving Stripe IDs as they are', async () => {
    const fake = new FakeStripe();
    const feature = await fake.entitlements.features.create({ name: 'Support', lookup_key: 'support' });
    const manifest = (() => {
      const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
      const support = new EntitlementFeature(stack, 'Support', { name: 'Support', lookupKey: 'support' });
      new Product(stack, 'Widget', { name: 'Widget', features: [support, 'feat_existing'] });
      return stack.synth();
    })();
    const product = manifest.resources.find((r) => r.id === 'Widget')!;

    const resolved = resolveReferences(product, indexResources(manifest), await observed(fake, manifest));

    expect(resolved.features).toEqual([feature.id, 'feat_existing']);
  });
});

describe('currentResource', () => {
  it('finds the object a resource is deployed as, with the features attached to a product', async () => {
    const fake = new FakeStripe();
    const feature = await fake.entitlements.features.create({ name: 'Support', lookup_key: 'support' });
    await fake.products.create({ id: 'FxStack_Widget', name: 'Widget' });
    await fake.products.createFeature('FxStack_Widget', { entitlement_feature: feature.id });
    const manifest = (() => {
      const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
      new Product(stack, 'Widget', { name: 'Widget', features: [] });
      new Coupon(stack, 'Missing', { percentOff: 5, duration: 'once' });
      return stack.synth();
    })();
    const observations = await readObservations(fake as unknown as Stripe, manifest, nextLock(manifest, emptyLock()));

    const product = currentResource(manifest.resources.find((r) => r.id === 'Widget')!, observations);
    const coupon = currentResource(manifest.resources.find((r) => r.id === 'Missing')!, observations);

    expect(product).toMatchObject({ id: 'FxStack_Widget', features: [feature.id] });
    expect(coupon).toBeUndefined();
  });
});
