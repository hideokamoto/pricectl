import Stripe from 'stripe';
import { DEFAULT_STRIPE_API_VERSION, Stack, StackManifest } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '@pricectl/constructs';
import { applyPlan } from '../../packages/cli/src/engine/apply-plan';
import { buildPlan } from '../../packages/cli/src/engine/build-plan';
import { emptyLock, LockFile, nextLock } from '../../packages/cli/src/engine/lock';

const apiKey = process.env.STRIPE_SECRET_KEY;
const describeWithStripe = apiKey ? describe : describe.skip;

describeWithStripe('price revision against Stripe test mode', () => {
  if (apiKey && !apiKey.includes('_test_')) {
    throw new Error('The end-to-end tests change real objects: use a Stripe test-mode key.');
  }

  const stripe = new Stripe(apiKey ?? 'unset', { apiVersion: DEFAULT_STRIPE_API_VERSION as Stripe.LatestApiVersion });
  // A stack ID per run keeps the derived IDs and lookup keys of runs apart
  const stackId = `E2e${Date.now()}`;
  let lock: LockFile = emptyLock();

  function define(build: (stack: Stack) => void): StackManifest {
    const stack = new Stack(undefined, stackId, { apiKey: apiKey ?? 'unset' });
    build(stack);
    return stack.synth();
  }

  /** Plan and apply a definition the way `pricectl deploy` does. */
  async function deploy(manifest: StackManifest) {
    lock = nextLock(manifest, lock);
    const plan = await buildPlan(stripe, manifest, lock);
    const result = await applyPlan(stripe, plan);
    return { plan, result };
  }

  const errorsOf = (result: Awaited<ReturnType<typeof deploy>>['result']) => result.items.filter((item) => item.error);

  async function expectNothingToDo(manifest: StackManifest) {
    const plan = await buildPlan(stripe, manifest, nextLock(manifest, lock));
    expect(plan.items.filter((item) => item.operation !== 'unchanged' || item.refusal)).toEqual([]);
  }

  const withDefaultPrice = (unitAmount: number, taxBehavior?: 'inclusive' | 'exclusive') =>
    define((stack) => {
      const product = new Product(stack, 'Pro', { name: `pricectl e2e ${stackId}` });
      new Price(stack, 'Monthly', {
        product,
        currency: 'usd',
        unitAmount,
        recurring: { interval: 'month' },
        isDefault: true,
        taxBehavior,
      });
    });

  afterAll(async () => {
    // Remove whatever is left; a failure here must not hide the test results
    try {
      await deploy(define(() => undefined));
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  it('creates a product with a default price and has nothing left to do afterwards', async () => {
    const manifest = withDefaultPrice(1000);

    const { result } = await deploy(manifest);

    expect(errorsOf(result)).toEqual([]);
    const product = await stripe.products.retrieve(`${stackId}_Pro`);
    const price = await stripe.prices.retrieve(product.default_price as string);
    expect(price).toMatchObject({ unit_amount: 1000, active: true, lookup_key: `${stackId}_Monthly` });
    await expectNothingToDo(manifest);
  });

  it('replaces the default price of a product when its amount changes (issue 44)', async () => {
    const before = await stripe.products.retrieve(`${stackId}_Pro`);
    const manifest = withDefaultPrice(2000);

    const { result } = await deploy(manifest);

    expect(errorsOf(result)).toEqual([]);
    const product = await stripe.products.retrieve(`${stackId}_Pro`);
    const replacement = await stripe.prices.retrieve(product.default_price as string);
    const original = await stripe.prices.retrieve(before.default_price as string);
    expect(replacement).toMatchObject({ unit_amount: 2000, active: true, lookup_key: `${stackId}_Monthly` });
    expect(replacement.metadata.pricectl_previous).toBe(original.id);
    expect(original).toMatchObject({ active: false, lookup_key: null });
    await expectNothingToDo(manifest);
  });

  it('sets tax behavior in place while it is unspecified, and makes a new version once it is set', async () => {
    const product = await stripe.products.retrieve(`${stackId}_Pro`);
    const beforeId = product.default_price as string;

    const inPlace = await deploy(withDefaultPrice(2000, 'inclusive'));
    const afterInPlace = (await stripe.products.retrieve(`${stackId}_Pro`)).default_price;
    const newVersion = await deploy(withDefaultPrice(2000, 'exclusive'));
    const afterNewVersion = (await stripe.products.retrieve(`${stackId}_Pro`)).default_price;

    expect(errorsOf(inPlace.result)).toEqual([]);
    expect(afterInPlace).toBe(beforeId);
    expect(errorsOf(newVersion.result)).toEqual([]);
    expect(afterNewVersion).not.toBe(beforeId);
    expect(await stripe.prices.retrieve(afterNewVersion as string)).toMatchObject({ tax_behavior: 'exclusive', active: true });
  });

  it('creates and then removes a feature, a coupon and a meter', async () => {
    const manifest = define((stack) => {
      const feature = new EntitlementFeature(stack, 'Support', { name: 'Support', lookupKey: `${stackId}_support` });
      new Product(stack, 'Pro', { name: `pricectl e2e ${stackId}`, features: [feature] });
      new Coupon(stack, 'Launch', { percentOff: 10, duration: 'once' });
      new Meter(stack, 'Calls', { displayName: 'Calls', eventName: `${stackId}_calls`, defaultAggregation: { formula: 'count' } });
    });

    const created = await deploy(manifest);
    await expectNothingToDo(manifest);
    const removed = await deploy(define((stack) => new Product(stack, 'Pro', { name: `pricectl e2e ${stackId}` })));

    expect(errorsOf(created.result)).toEqual([]);
    expect(errorsOf(removed.result)).toEqual([]);
    await expect(stripe.coupons.retrieve(`${stackId}_Launch`)).rejects.toMatchObject({ code: 'resource_missing' });
    const meters = await stripe.billing.meters.list({ status: 'active', limit: 100 });
    expect(meters.data.some((meter) => meter.event_name === `${stackId}_calls`)).toBe(false);
  });

  it('archives the default price after unsetting it when the stack is destroyed', async () => {
    const { result } = await deploy(define(() => undefined));

    expect(errorsOf(result)).toEqual([]);
    const product = await stripe.products.retrieve(`${stackId}_Pro`);
    expect(product).toMatchObject({ active: false, default_price: null });
    const prices = await stripe.prices.list({ product: product.id });
    expect(prices.data.every((price) => !price.active)).toBe(true);
  });
});

describeWithStripe('lookup keys against Stripe test mode', () => {
  const stripe = new Stripe(apiKey ?? 'unset', { apiVersion: DEFAULT_STRIPE_API_VERSION as Stripe.LatestApiVersion });
  const stackId = `E2eKeys${Date.now()}`;
  let lock: LockFile = emptyLock();

  function define(build: (stack: Stack) => void): StackManifest {
    const stack = new Stack(undefined, stackId, { apiKey: apiKey ?? 'unset' });
    build(stack);
    return stack.synth();
  }

  async function plan(manifest: StackManifest) {
    lock = nextLock(manifest, lock);
    return buildPlan(stripe, manifest, lock);
  }

  async function deploy(manifest: StackManifest) {
    const built = await plan(manifest);
    return applyPlan(stripe, built);
  }

  const priceWithKey = (lookupKey: string, transferLookupKey = false) =>
    define((stack) => {
      const product = new Product(stack, 'Pro', { name: `pricectl e2e ${stackId}` });
      new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 1000, lookupKey, transferLookupKey });
    });

  afterAll(async () => {
    try {
      await deploy(define(() => undefined));
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  it('follows a changed lookup key: the old price is archived and the new one holds the new key', async () => {
    await deploy(priceWithKey(`${stackId}_v1`));

    const result = await deploy(priceWithKey(`${stackId}_v2`));

    expect(result.items.filter((item) => item.error)).toEqual([]);
    const active = await stripe.prices.list({ product: `${stackId}_Pro`, active: true });
    expect(active.data.map((price) => price.lookup_key)).toEqual([`${stackId}_v2`]);
    // An archived price keeps its lookup key; it is off sale
    const old = await stripe.prices.list({ lookup_keys: [`${stackId}_v1`] });
    expect(old.data.map((price) => price.active)).toEqual([false]);
  });

  it('refuses a lookup key held by a price outside the stack, and takes it over only when allowed', async () => {
    const key = `${stackId}_shared`;
    const outside = await stripe.prices.create({ product: `${stackId}_Pro`, currency: 'usd', unit_amount: 1, lookup_key: key });

    const refused = await plan(priceWithKey(key));
    const taken = await deploy(priceWithKey(key, true));

    expect(refused.items.find((item) => item.id === 'Monthly')!.refusal).toContain(outside.id);
    expect(taken.items.filter((item) => item.error)).toEqual([]);
    const holder = await stripe.prices.list({ lookup_keys: [key] });
    expect(holder.data[0].id).not.toBe(outside.id);
    expect((await stripe.prices.retrieve(outside.id)).active).toBe(true);
    await stripe.prices.update(outside.id, { active: false });
  });
});
