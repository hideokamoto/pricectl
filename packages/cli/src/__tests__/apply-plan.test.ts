import { Stack, StackManifest } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import type Stripe from 'stripe';
import { applyPlan } from '../engine/apply-plan';
import { buildPlan } from '../engine/build-plan';
import { emptyLock, LockFile, nextLock } from '../engine/lock';
import { FakeStripe } from './helpers/fake-stripe';

const asStripe = (fake: FakeStripe) => fake as unknown as Stripe;

function shop(define: (stack: Stack) => void): StackManifest {
  const stack = new Stack(undefined, 'Shop', { apiKey: 'sk_test_dummy' });
  define(stack);
  return stack.synth();
}

/** Plan and apply a definition the way deploy does, with the lock the definition implies. */
async function deploy(fake: FakeStripe, manifest: StackManifest, previous: LockFile = emptyLock()) {
  const lock = nextLock(manifest, previous);
  const plan = await buildPlan(asStripe(fake), manifest, lock);
  const result = await applyPlan(asStripe(fake), plan);
  return { plan, result, lock };
}

describe('applyPlan: a first deploy', () => {
  const manifest = shop((stack) => {
    const meter = new Meter(stack, 'Calls', { displayName: 'Calls', eventName: 'api_calls', defaultAggregation: { formula: 'count' } });
    const feature = new EntitlementFeature(stack, 'Support', { name: 'Support', lookupKey: 'support' });
    const product = new Product(stack, 'Pro', { name: 'Pro', features: [feature] });
    new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' });
    new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' }, isDefault: true });
    new Price(stack, 'Usage', { product, currency: 'usd', recurring: { interval: 'month', usageType: 'metered', meter } });
  });

  it('creates every resource in Stripe without errors', async () => {
    const fake = new FakeStripe();

    const { result } = await deploy(fake, manifest);

    expect(result.items.filter((i) => i.error)).toEqual([]);
    expect(fake.productStore.has('Shop_Pro')).toBe(true);
    expect(fake.couponStore.has('Shop_Launch')).toBe(true);
    expect([...fake.priceStore.values()].map((p) => p.lookup_key).sort()).toEqual(['Shop_Monthly', 'Shop_Usage']);
  });

  it('attaches the feature and points the metered price at the meter it created', async () => {
    const fake = new FakeStripe();

    await deploy(fake, manifest);

    const feature = [...fake.featureStore.values()][0];
    const meter = [...fake.meterStore.values()][0];
    const usage = [...fake.priceStore.values()].find((p) => p.lookup_key === 'Shop_Usage')!;
    expect(fake.featuresOf('Shop_Pro')).toEqual([feature.id]);
    expect(usage.recurring.meter).toBe(meter.id);
  });

  it('makes the declared default price the default of the product', async () => {
    const fake = new FakeStripe();

    await deploy(fake, manifest);

    const monthly = [...fake.priceStore.values()].find((p) => p.lookup_key === 'Shop_Monthly')!;
    expect(fake.productStore.get('Shop_Pro')!.default_price).toBe(monthly.id);
  });

  it('leaves nothing to do on the next plan', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, manifest);

    const again = await buildPlan(asStripe(fake), manifest, lock);

    expect(again.items.filter((i) => i.operation !== 'unchanged')).toEqual([]);
  });
});

describe('applyPlan: changing a price that is the default price of its product (issue 44)', () => {
  const definition = (unitAmount: number) =>
    shop((stack) => {
      const product = new Product(stack, 'Pro', { name: 'Pro' });
      new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount, recurring: { interval: 'month' }, isDefault: true });
    });

  it('replaces the price, moves the default to the new one and archives the old one', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, definition(1000));
    const oldPrice = [...fake.priceStore.values()][0];

    const { result } = await deploy(fake, definition(2000), lock);

    const newPrice = [...fake.priceStore.values()].find((p) => p.id !== oldPrice.id)!;
    expect(result.items.filter((i) => i.error)).toEqual([]);
    expect(newPrice).toMatchObject({ unit_amount: 2000, active: true, lookup_key: 'Shop_Monthly' });
    expect(newPrice.metadata.pricectl_previous).toBe(oldPrice.id);
    expect(fake.priceStore.get(oldPrice.id)).toMatchObject({ active: false, lookup_key: null });
    expect(fake.productStore.get('Shop_Pro')!.default_price).toBe(newPrice.id);
  });

  it('follows a default price that was set in Stripe but not declared', async () => {
    const fake = new FakeStripe();
    const undeclared = (unitAmount: number) =>
      shop((stack) => {
        const product = new Product(stack, 'Pro', { name: 'Pro' });
        new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount, recurring: { interval: 'month' } });
      });
    const { lock } = await deploy(fake, undeclared(1000));
    const oldPrice = [...fake.priceStore.values()][0];
    await fake.products.update('Shop_Pro', { default_price: oldPrice.id });

    await deploy(fake, undeclared(2000), lock);

    const newPrice = [...fake.priceStore.values()].find((p) => p.id !== oldPrice.id)!;
    expect(fake.productStore.get('Shop_Pro')!.default_price).toBe(newPrice.id);
  });

  it('finishes the replacement on the next deploy when a call fails part way', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, definition(1000));
    fake.failNext('products.update', { message: 'Request timed out' });

    const failed = await deploy(fake, definition(2000), lock);
    const recovered = await deploy(fake, definition(2000), lock);

    expect(failed.result.items.find((i) => i.id === 'Monthly')!.error).toContain('Request timed out');
    expect(recovered.result.items.filter((i) => i.error)).toEqual([]);
    const active = [...fake.priceStore.values()].filter((p) => p.active);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ unit_amount: 2000, lookup_key: 'Shop_Monthly' });
    expect(fake.productStore.get('Shop_Pro')!.default_price).toBe(active[0].id);
  });
});

describe('applyPlan: removing resources that left the definition', () => {
  it('archives the default price after unsetting it, and archives a product that has prices', async () => {
    const fake = new FakeStripe();
    const full = shop((stack) => {
      const product = new Product(stack, 'Pro', { name: 'Pro' });
      new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 1000, recurring: { interval: 'month' }, isDefault: true });
      new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' });
    });
    const { lock } = await deploy(fake, full);

    const { result } = await deploy(fake, shop(() => undefined), lock);

    expect(result.items.filter((i) => i.error)).toEqual([]);
    expect([...fake.priceStore.values()].every((p) => !p.active)).toBe(true);
    expect(fake.productStore.get('Shop_Pro')).toMatchObject({ active: false, default_price: null });
    expect(fake.couponStore.has('Shop_Launch')).toBe(false);
  });

  it('does not remove anything when a defined resource failed', async () => {
    const fake = new FakeStripe();
    const before = shop((stack) => new Coupon(stack, 'Old', { percentOff: 5, duration: 'once' }));
    const { lock } = await deploy(fake, before);
    const after = shop((stack) => new Coupon(stack, 'New', { percentOff: 10, duration: 'once' }));
    fake.failNext('coupons.create', { message: 'Request timed out' });

    const { result } = await deploy(fake, after, lock);

    expect(result.removalSkipped).toBe(true);
    expect(fake.couponStore.has('Shop_Old')).toBe(true);
  });
});

describe('applyPlan: refusals', () => {
  it('changes nothing when the plan has a refusal', async () => {
    const fake = new FakeStripe();
    const { lock } = await deploy(fake, shop((stack) => new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' })));
    const changed = shop((stack) => {
      new Coupon(stack, 'Launch', { percentOff: 25, duration: 'once' });
      new Product(stack, 'Pro', { name: 'Pro' });
    });

    await expect(deploy(fake, changed, lock)).rejects.toThrow(/percent_off/);
    expect(fake.productStore.has('Shop_Pro')).toBe(false);
  });
});
