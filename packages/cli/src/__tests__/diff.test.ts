import { Stack } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import { diffResource, resolveReferencesFromState } from '../engine/diff';
import { StateManager } from '../engine/state';
import { asSdkPrice } from './helpers/sdk-shapes';
import { InMemoryStateStore } from './helpers/in-memory-state-store';
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

describe('resolveReferencesFromState', () => {
  /** State kept in memory, so the test does not touch the filesystem. */
  function stateWith(...entries: Array<{ logicalId: string; physicalId: string; type: string }>): StateManager {
    const state = new StateManager(new InMemoryStateStore());
    for (const entry of entries) {
      state.setResource('FxStack', { ...entry, path: `FxStack/${entry.logicalId}`, lastDeployedAt: '', propertiesHash: '' });
    }
    return state;
  }

  it('resolves the product and the meter of a metered price to their Stripe IDs', () => {
    const state = stateWith(
      { logicalId: 'NewProd', physicalId: 'prod_123', type: 'Stripe::Product' },
      { logicalId: 'NewMeter', physicalId: 'mtr_456', type: 'Stripe::BillingMeter' },
    );

    const resolved = resolveReferencesFromState(
      {
        type: 'Stripe::Price',
        properties: { product: 'NewProd', recurring: { interval: 'month', usage_type: 'metered', meter: 'NewMeter' } },
      },
      'FxStack',
      state,
    );

    expect(resolved).toMatchObject({ product: 'prod_123', recurring: { meter: 'mtr_456' } });
  });

  it('resolves the entitlement features of a product to their Stripe IDs', () => {
    const state = stateWith({ logicalId: 'Support', physicalId: 'feat_123', type: 'Stripe::EntitlementFeature' });

    const resolved = resolveReferencesFromState(
      { type: 'Stripe::Product', properties: { name: 'Widget', features: ['Support', 'feat_existing'] } },
      'FxStack',
      state,
    );

    expect(resolved.features).toEqual(['feat_123', 'feat_existing']);
  });
});

