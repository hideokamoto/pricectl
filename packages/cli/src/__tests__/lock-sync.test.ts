import { StackManifest } from '@pricectl/core';
import { InMemoryLockStore } from './helpers/in-memory-lock-store';
import { syncLock } from '../engine/lock-store';
import { parseLock } from '../engine/lock';

const manifest: StackManifest = {
  stackId: 'Shop',
  tags: {},
  resources: [{ id: 'Pro', key: 'Shop_Pro', path: 'Shop/Pro', type: 'Stripe::Product', properties: { name: 'Pro' } }],
};

describe('syncLock', () => {
  it('writes the lock the definition implies', () => {
    const store = new InMemoryLockStore();

    const result = syncLock(manifest, store, { frozen: false });

    expect(parseLock(store.read()).stacks.Shop).toEqual({ 'Stripe::Product': { Shop_Pro: 'managed' } });
    expect(result).toEqual({ ok: true, changed: true });
  });

  it('does not write when the lock is already up to date', () => {
    const store = new InMemoryLockStore();
    syncLock(manifest, store, { frozen: false });
    store.writes = 0;

    const result = syncLock(manifest, store, { frozen: false });

    expect(store.writes).toBe(0);
    expect(result).toEqual({ ok: true, changed: false });
  });

  it('with a frozen lock, refuses an out-of-date lock and writes nothing', () => {
    const store = new InMemoryLockStore();

    const result = syncLock(manifest, store, { frozen: true });

    expect(result.ok).toBe(false);
    expect(store.read()).toBeUndefined();
  });

  it('with a frozen lock, accepts an up-to-date lock', () => {
    const store = new InMemoryLockStore();
    syncLock(manifest, store, { frozen: false });

    expect(syncLock(manifest, store, { frozen: true })).toEqual({ ok: true, changed: false });
  });
});
