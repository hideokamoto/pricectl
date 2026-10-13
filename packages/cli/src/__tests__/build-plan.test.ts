import { Stack, StackManifest } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import type Stripe from 'stripe';
import { buildPlan } from '../engine/build-plan';
import { emptyLock, LockFile, nextLock } from '../engine/lock';
import { FakeStripe } from './helpers/fake-stripe';

const asStripe = (fake: FakeStripe) => fake as unknown as Stripe;

function shop(define: (stack: Stack) => void): StackManifest {
  const stack = new Stack(undefined, 'Shop', { apiKey: 'sk_test_dummy' });
  define(stack);
  return stack.synth();
}

function planFor(fake: FakeStripe, manifest: StackManifest, lock: LockFile = nextLock(manifest, emptyLock())) {
  return buildPlan(asStripe(fake), manifest, lock);
}

describe('buildPlan for an account without the stack', () => {
  const manifest = shop((stack) => {
    const meter = new Meter(stack, 'Calls', { displayName: 'Calls', eventName: 'api_calls', defaultAggregation: { formula: 'count' } });
    const feature = new EntitlementFeature(stack, 'Support', { name: 'Support', lookupKey: 'support' });
    const product = new Product(stack, 'Pro', { name: 'Pro', features: [feature] });
    new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' });
    new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' } });
    new Price(stack, 'Usage', { product, currency: 'usd', recurring: { interval: 'month', usageType: 'metered', meter } });
  });

  it('creates every resource, dependencies before the resources that refer to them', async () => {
    const plan = await planFor(new FakeStripe(), manifest);

    expect(plan.items.map((i) => [i.id, i.operation])).toEqual([
      ['Calls', 'create'],
      ['Support', 'create'],
      ['Pro', 'create'],
      ['Launch', 'create'],
      ['Monthly', 'create'],
      ['Usage', 'create'],
    ]);
  });

  it('refers to a product by the ID pricectl gives it', async () => {
    const plan = await planFor(new FakeStripe(), manifest);

    const monthly = plan.items.find((i) => i.id === 'Monthly')!;
    expect(monthly.steps[0]).toMatchObject({ kind: 'create', params: { product: 'Shop_Pro', lookup_key: 'Shop_Monthly' } });
  });

  it('keeps the logical ID of a meter or feature that does not exist yet, to be resolved when applied', async () => {
    const plan = await planFor(new FakeStripe(), manifest);

    expect(plan.items.find((i) => i.id === 'Usage')!.steps[0]).toMatchObject({ params: { recurring: { meter: 'Calls' } } });
    expect(plan.items.find((i) => i.id === 'Pro')!.steps).toContainEqual({ kind: 'attachFeature', productId: 'Shop_Pro', featureId: 'Support' });
  });
});

describe('buildPlan for a resource that left the definition', () => {
  it('removes what the lock marks as removing, by its key', async () => {
    const fake = new FakeStripe();
    await fake.products.create({ id: 'Shop_Pro', name: 'Pro', metadata: { pricectl_stack: 'Shop', pricectl_id: 'Pro' } });
    await fake.prices.create({
      product: 'Shop_Pro', currency: 'usd', unit_amount: 100, lookup_key: 'Shop_Old', metadata: { pricectl_stack: 'Shop', pricectl_id: 'Old' },
    });
    const before = shop((stack) => {
      const product = new Product(stack, 'Pro', { name: 'Pro' });
      new Price(stack, 'Old', { product, currency: 'usd', unitAmount: 100 });
    });
    const after = shop((stack) => new Product(stack, 'Pro', { name: 'Pro' }));
    const lock = nextLock(after, nextLock(before, emptyLock()));

    const plan = await planFor(fake, after, lock);

    const removal = plan.items.find((i) => i.operation === 'remove')!;
    expect(removal).toMatchObject({ id: 'Shop_Old', type: 'Stripe::Price' });
    expect(removal.steps).toEqual([{ kind: 'archive', priceId: expect.any(String) }]);
  });

  it('puts removals after everything that is created or updated', async () => {
    const fake = new FakeStripe();
    await fake.products.create({ id: 'Shop_Gone', name: 'Gone', metadata: { pricectl_stack: 'Shop' } });
    const before = shop((stack) => new Product(stack, 'Gone', { name: 'Gone' }));
    const after = shop((stack) => new Product(stack, 'Pro', { name: 'Pro' }));
    const lock = nextLock(after, nextLock(before, emptyLock()));

    const plan = await planFor(fake, after, lock);

    expect(plan.items.map((i) => i.operation)).toEqual(['create', 'remove']);
  });

  it('removes a price before the product it sits on, and a product before the features it grants', async () => {
    const fake = new FakeStripe();
    const tags = { pricectl_stack: 'Shop' };
    await fake.products.create({ id: 'Shop_Gone', name: 'Gone', metadata: tags });
    await fake.prices.create({ product: 'Shop_Gone', currency: 'usd', unit_amount: 1, lookup_key: 'Shop_GonePrice', metadata: tags });
    await fake.entitlements.features.create({ name: 'F', lookup_key: 'gone_feature', metadata: tags });
    const before = shop((stack) => {
      const feature = new EntitlementFeature(stack, 'GoneFeature', { name: 'F', lookupKey: 'gone_feature' });
      const product = new Product(stack, 'Gone', { name: 'Gone', features: [feature] });
      new Price(stack, 'GonePrice', { product, currency: 'usd', unitAmount: 1 });
    });
    const after = shop((stack) => new Product(stack, 'Pro', { name: 'Pro' }));
    const lock = nextLock(after, nextLock(before, emptyLock()));

    const plan = await planFor(fake, after, lock);

    expect(plan.items.filter((i) => i.operation === 'remove').map((i) => i.type)).toEqual([
      'Stripe::Price',
      'Stripe::Product',
      'Stripe::EntitlementFeature',
    ]);
  });

  it('does nothing for a removed key whose object is already gone', async () => {
    const before = shop((stack) => new Product(stack, 'Gone', { name: 'Gone' }));
    const after = shop((stack) => new Product(stack, 'Pro', { name: 'Pro' }));
    const lock = nextLock(after, nextLock(before, emptyLock()));

    const plan = await planFor(new FakeStripe(), after, lock);

    expect(plan.items.filter((i) => i.operation === 'remove')).toEqual([]);
  });
});
