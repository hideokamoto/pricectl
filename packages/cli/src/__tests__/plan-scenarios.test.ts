import { Stack, StackManifest } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import type Stripe from 'stripe';
import { applyPlan } from '../engine/apply-plan';
import { buildPlan } from '../engine/build-plan';
import { emptyLock, LockFile, nextLock } from '../engine/lock';
import { FakeStripe } from './helpers/fake-stripe';
import recurringPriceFixture from './fixtures/stripe/price-recurring.json';
import lookupPriceFixture from './fixtures/stripe/price-one-time-lookup.json';
import tieredPriceFixture from './fixtures/stripe/price-tiered-expanded.json';
import meterFixture from './fixtures/stripe/meter.json';
import featureFixture from './fixtures/stripe/feature.json';
import productFixture from './fixtures/stripe/product.json';

const asStripe = (fake: FakeStripe) => fake as unknown as Stripe;

function define(build: (stack: Stack) => void): StackManifest {
  const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
  build(stack);
  return stack.synth();
}

async function plan(fake: FakeStripe, manifest: StackManifest, previous: LockFile = emptyLock()) {
  return buildPlan(asStripe(fake), manifest, nextLock(manifest, previous));
}

async function deploy(fake: FakeStripe, manifest: StackManifest, previous: LockFile = emptyLock()) {
  const lock = nextLock(manifest, previous);
  const result = await applyPlan(asStripe(fake), await buildPlan(asStripe(fake), manifest, lock));
  return { lock, result };
}

/** A price as pricectl leaves it in Stripe: the recorded object, holding the key and the stack tag. */
const deployedAs = (fixture: Record<string, unknown>, logicalId: string, key: string) => ({
  ...fixture,
  lookup_key: key,
  metadata: { pricectl_stack: 'FxStack', pricectl_id: logicalId },
});

describe('prices that already exist as recorded Stripe objects', () => {
  it.each([
    [
      'recurring price',
      'FxMonthly',
      'FxStack_FxMonthly',
      recurringPriceFixture,
      (stack: Stack) =>
        new Price(stack, 'FxMonthly', { product: productFixture.id, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } }),
    ],
    [
      'one-time price with a lookup key',
      'FxLookup',
      lookupPriceFixture.lookup_key,
      lookupPriceFixture,
      (stack: Stack) =>
        new Price(stack, 'FxLookup', { product: productFixture.id, currency: 'usd', unitAmount: 500, lookupKey: lookupPriceFixture.lookup_key }),
    ],
    [
      'tiered price, which Stripe returns without tiers unless they are expanded',
      'FxTiered',
      'FxStack_FxTiered',
      tieredPriceFixture,
      (stack: Stack) =>
        new Price(stack, 'FxTiered', {
          product: productFixture.id,
          currency: 'usd',
          recurring: { interval: 'month', usageType: 'licensed' },
          tiersMode: 'graduated',
          tiers: [
            { upTo: 1000, unitAmount: 10 },
            { upTo: 'inf', unitAmount: 2, flatAmount: 100 },
          ],
        }),
    ],
  ])('keeps a %s as it is', async (_label, logicalId, key, fixture, build) => {
    const fake = new FakeStripe();
    fake.seed('prices', deployedAs(fixture, logicalId, key));

    const result = await plan(fake, define(build));

    expect(result.items).toMatchObject([{ id: logicalId, operation: 'unchanged' }]);
  });

  it('creates a new version when the amount differs from the recorded price', async () => {
    const fake = new FakeStripe();
    fake.seed('prices', deployedAs(recurringPriceFixture, 'FxMonthly', 'FxStack_FxMonthly'));
    const manifest = define(
      (stack) => new Price(stack, 'FxMonthly', { product: productFixture.id, currency: 'usd', unitAmount: 1200, recurring: { interval: 'month' } }),
    );

    const result = await plan(fake, manifest);

    expect(result.items[0].steps.map((s) => s.kind)).toEqual(['create', 'archive']);
  });
});

describe('resources adopted by physicalId', () => {
  it('uses the existing product instead of creating one', async () => {
    const fake = new FakeStripe();
    fake.seed('products', productFixture);
    const manifest = define((stack) => new Product(stack, 'Adopted', { physicalId: productFixture.id, name: productFixture.name }));

    const result = await plan(fake, manifest);

    expect(result.items[0]).toMatchObject({ operation: 'unchanged', physicalId: productFixture.id });
    expect(result.items[0].steps.map((s) => s.kind)).not.toContain('createProduct');
  });

  it('fails the plan when the adopted product does not exist', async () => {
    const manifest = define((stack) => new Product(stack, 'Adopted', { physicalId: 'prod_missing', name: 'x' }));

    await expect(plan(new FakeStripe(), manifest)).rejects.toThrow(/prod_missing/);
  });

  it('uses the adopted meter even when another active meter has the same event name', async () => {
    const fake = new FakeStripe();
    fake.seed('meters', meterFixture);
    const manifest = define(
      (stack) =>
        new Meter(stack, 'Adopted', {
          physicalId: meterFixture.id,
          displayName: meterFixture.display_name,
          eventName: meterFixture.event_name,
          defaultAggregation: { formula: 'count' },
        }),
    );

    const result = await plan(fake, manifest);

    expect(result.items[0]).toMatchObject({ operation: 'unchanged', physicalId: meterFixture.id });
  });

  it('refuses an adopted meter whose event name differs, because Stripe cannot change it', async () => {
    const fake = new FakeStripe();
    fake.seed('meters', meterFixture);
    const manifest = define(
      (stack) =>
        new Meter(stack, 'Adopted', { physicalId: meterFixture.id, displayName: 'x', eventName: 'other_event', defaultAggregation: { formula: 'count' } }),
    );

    const result = await plan(fake, manifest);

    expect(result.items[0].refusal).toContain('Stripe does not allow changing event_name');
  });

  it('refuses an adopted feature whose lookup key differs', async () => {
    const fake = new FakeStripe();
    fake.seed('features', featureFixture);
    const manifest = define(
      (stack) => new EntitlementFeature(stack, 'Adopted', { physicalId: featureFixture.id, name: 'x', lookupKey: 'other_key' }),
    );

    const result = await plan(fake, manifest);

    expect(result.items[0].refusal).toContain('Stripe does not allow changing lookup_key');
  });

  it('does not claim an adopted resource in the lock, so it is never removed', async () => {
    const fake = new FakeStripe();
    fake.seed('products', productFixture);
    const adopted = define((stack) => new Product(stack, 'Adopted', { physicalId: productFixture.id, name: productFixture.name }));
    const { lock } = await deploy(fake, adopted);

    const result = await deploy(fake, define(() => undefined), lock);

    expect(result.result.items).toEqual([]);
    expect(fake.productStore.get(productFixture.id)).toMatchObject({ active: true });
  });
});

describe('resources that are still referred to by their Stripe ID', () => {
  it('keeps a removed product that a defined price still names', async () => {
    const fake = new FakeStripe();
    const before = define((stack) => new Product(stack, 'Pro', { name: 'Pro' }));
    const { lock } = await deploy(fake, before);
    const after = define((stack) => new Price(stack, 'Monthly', { product: 'FxStack_Pro', currency: 'usd', unitAmount: 100 }));

    const result = await plan(fake, after, lock);

    expect(result.items.filter((i) => i.operation === 'remove')).toEqual([]);
  });
});

describe('a plan with an item of an unknown type', () => {
  it('refuses it by name', async () => {
    const manifest = define(() => undefined);
    manifest.resources.push({ id: 'Mystery', key: 'FxStack_Mystery', path: 'FxStack/Mystery', type: 'Stripe::Unknown', properties: {} });

    const result = await plan(new FakeStripe(), manifest);

    expect(result.items[0].refusal).toBe('Unknown resource type: Stripe::Unknown');
  });
});

describe('after destroy', () => {
  const full = define((stack) => {
    const meter = new Meter(stack, 'Calls', { displayName: 'Calls', eventName: 'api_calls', defaultAggregation: { formula: 'count' } });
    const feature = new EntitlementFeature(stack, 'Support', { name: 'Support', lookupKey: 'support' });
    new Product(stack, 'Pro', { name: 'Pro', features: [feature] });
    new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' });
    new Price(stack, 'Usage', { product: 'FxStack_Pro', currency: 'usd', recurring: { interval: 'month', usageType: 'metered', meter } });
  });

  it('deactivates features and meters that left the definition', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, full);

    const { result } = await deploy(fake, define(() => undefined), lock);

    expect(result.items.filter((i) => i.error)).toEqual([]);
    expect([...fake.featureStore.values()].every((f) => !f.active)).toBe(true);
    expect([...fake.meterStore.values()].every((m) => m.status === 'inactive')).toBe(true);
  });

  it('deploys the same definition again: archived product back on sale, new feature and meter', async () => {
    const fake = new FakeStripe();
    const first = await deploy(fake, full);
    const destroyed = await deploy(fake, define(() => undefined), first.lock);

    const again = await deploy(fake, full, destroyed.lock);

    expect(again.result.items.filter((i) => i.error)).toEqual([]);
    expect(fake.productStore.get('FxStack_Pro')).toMatchObject({ active: true });
    expect([...fake.featureStore.values()].filter((f) => f.active)).toHaveLength(1);
    expect([...fake.meterStore.values()].filter((m) => m.status === 'active')).toHaveLength(1);
    expect((await plan(fake, full, again.lock)).items.filter((i) => i.operation !== 'unchanged')).toEqual([]);
  });
});

describe('changing the lookup key of a price', () => {
  const withKey = (lookupKey: string) =>
    define((stack) => {
      const product = new Product(stack, 'Pro', { name: 'Pro' });
      new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 1000, lookupKey });
    });

  it('creates a price with the new key and archives the price with the old key', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, withKey('monthly_v1'));

    const { result } = await deploy(fake, withKey('monthly_v2'), lock);

    expect(result.items.filter((i) => i.error)).toEqual([]);
    const prices = [...fake.priceStore.values()];
    expect(prices.filter((p) => p.active).map((p) => p.lookup_key)).toEqual(['monthly_v2']);
    expect(prices.find((p) => p.metadata.pricectl_id === 'Monthly' && !p.active)).toBeDefined();
  });

  it('warns that it looks like a rename and asks for approval as a removal', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, withKey('monthly_v1'));

    const result = await plan(fake, withKey('monthly_v2'), lock);

    expect(result.items.map((i) => i.operation)).toEqual(['unchanged', 'create', 'remove']);
  });
});
