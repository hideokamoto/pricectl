import { Stack, StackManifest } from '@pricectl/core';
import { Coupon, Product } from '@pricectl/constructs';
import type Stripe from 'stripe';
import { applyPlan } from '../engine/apply-plan';
import { emptyLock, parseLock, serializeLock } from '../engine/lock';
import { finishDestroy, planDeploy, planDestroy } from '../engine/stack-run';
import { FakeStripe } from './helpers/fake-stripe';
import { InMemoryLockStore } from './helpers/in-memory-lock-store';

const asStripe = (fake: FakeStripe) => fake as unknown as Stripe;

function shop(define: (stack: Stack) => void = () => undefined): StackManifest {
  const stack = new Stack(undefined, 'Shop', { apiKey: 'sk_test_dummy' });
  define(stack);
  return stack.synth();
}

const withProduct = () => shop((stack) => new Product(stack, 'Pro', { name: 'Pro' }));

describe('planDeploy', () => {
  it('records the keys of the definition in the lock and plans against it', async () => {
    const store = new InMemoryLockStore();

    const run = await planDeploy(asStripe(new FakeStripe()), withProduct(), store, { frozen: false });

    expect(run.ok && run.plan.items.map((i) => i.operation)).toEqual(['create']);
    expect(parseLock(store.read()).stacks.Shop).toEqual({ 'Stripe::Product': { Shop_Pro: 'managed' } });
  });

  it('with a frozen lock, refuses an out-of-date lock without reading Stripe or writing the lock', async () => {
    const store = new InMemoryLockStore();
    const fake = new FakeStripe();
    const read = jest.spyOn(fake.products, 'retrieve');

    const run = await planDeploy(asStripe(fake), withProduct(), store, { frozen: true });

    expect(run).toMatchObject({ ok: false });
    expect(read).not.toHaveBeenCalled();
    expect(store.read()).toBeUndefined();
  });

  it('keeps a removed key in the lock as removing and plans its removal', async () => {
    const fake = new FakeStripe();
    const store = new InMemoryLockStore();
    const full = shop((stack) => {
      new Product(stack, 'Pro', { name: 'Pro' });
      new Coupon(stack, 'Old', { percentOff: 5, duration: 'once' });
    });
    const first = await planDeploy(asStripe(fake), full, store, { frozen: false });
    if (first.ok) await applyPlan(asStripe(fake), first.plan);

    const run = await planDeploy(asStripe(fake), withProduct(), store, { frozen: false });

    expect(parseLock(store.read()).stacks.Shop['Stripe::Coupon']).toEqual({ Shop_Old: 'removing' });
    expect(run.ok && run.plan.items.filter((i) => i.operation === 'remove').map((i) => i.id)).toEqual(['Shop_Old']);
  });
});

describe('planDestroy and finishDestroy', () => {
  async function deployedShop() {
    const fake = new FakeStripe();
    const store = new InMemoryLockStore();
    const deployed = await planDeploy(asStripe(fake), withProduct(), store, { frozen: false });
    if (deployed.ok) await applyPlan(asStripe(fake), deployed.plan);
    return { fake, store };
  }

  it('plans the removal of everything the stack claims, without touching the lock', async () => {
    const { fake, store } = await deployedShop();
    const before = store.read();

    const plan = await planDestroy(asStripe(fake), withProduct(), store);

    expect(plan.items.map((i) => [i.operation, i.id])).toEqual([['remove', 'Shop_Pro']]);
    expect(store.read()).toBe(before);
  });

  it('forgets the stack in the lock once everything was removed', async () => {
    const { fake, store } = await deployedShop();
    const plan = await planDestroy(asStripe(fake), withProduct(), store);
    const result = await applyPlan(asStripe(fake), plan);

    finishDestroy(store, 'Shop', result);

    expect(parseLock(store.read()).stacks.Shop).toBeUndefined();
  });

  it('keeps the keys as removing when something could not be removed, so the next destroy finishes', async () => {
    const { fake, store } = await deployedShop();
    const plan = await planDestroy(asStripe(fake), withProduct(), store);
    fake.failNext('products.del', { message: 'Request timed out' });
    const result = await applyPlan(asStripe(fake), plan);

    finishDestroy(store, 'Shop', result);

    expect(parseLock(store.read()).stacks.Shop['Stripe::Product']).toEqual({ Shop_Pro: 'removing' });
  });

  it('reads a missing lock as nothing claimed, so destroy has nothing to do', async () => {
    const plan = await planDestroy(asStripe(new FakeStripe()), withProduct(), new InMemoryLockStore());

    expect(plan.items).toEqual([]);
  });

  it('refuses to destroy with a lock that cannot be read', async () => {
    const store = new InMemoryLockStore();
    store.write('{ broken');

    await expect(planDestroy(asStripe(new FakeStripe()), withProduct(), store)).rejects.toThrow(/pricectl\.lock\.json/);
  });
});

describe('lock serialization', () => {
  it('is the same text for the same claims', () => {
    expect(serializeLock(emptyLock())).toBe('{\n  "stacks": {},\n  "version": 1\n}\n');
  });
});
