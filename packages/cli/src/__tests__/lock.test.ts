import { ResourceManifest, StackManifest } from '@pricectl/core';
import { checkFrozenLock, emptyLock, LockFile, nextLock, parseLock, serializeLock } from '../engine/lock';

function resource(type: string, id: string, properties: Record<string, unknown> = {}, extra: Partial<ResourceManifest> = {}): ResourceManifest {
  return { id, key: `Shop_${id}`, path: `Shop/${id}`, type, properties, ...extra };
}

function manifestOf(...resources: ResourceManifest[]): StackManifest {
  return { stackId: 'Shop', tags: {}, resources };
}

const product = (id: string) => resource('Stripe::Product', id, { name: id });
const price = (id: string, properties: Record<string, unknown> = {}) => resource('Stripe::Price', id, properties);
const meter = (id: string, eventName: string) => resource('Stripe::BillingMeter', id, { event_name: eventName });

describe('nextLock', () => {
  it('claims the key of each defined resource as managed, by type', () => {
    const lock = nextLock(
      manifestOf(
        product('Pro'),
        price('Monthly'),
        price('Yearly', { lookup_key: 'yearly' }),
        resource('Stripe::Coupon', 'Launch', { percent_off: 10 }),
        resource('Stripe::EntitlementFeature', 'Support', { name: 'Support', lookup_key: 'support' }),
        meter('Calls', 'api_calls'),
      ),
      emptyLock(),
    );

    expect(lock.stacks.Shop).toEqual({
      'Stripe::Product': { Shop_Pro: 'managed' },
      'Stripe::Price': { Shop_Monthly: 'managed', yearly: 'managed' },
      'Stripe::Coupon': { Shop_Launch: 'managed' },
      'Stripe::EntitlementFeature': { support: 'managed' },
      'Stripe::BillingMeter': { api_calls: 'managed' },
    });
  });

  it('marks a key that is no longer defined as removing', () => {
    const before = nextLock(manifestOf(price('Old'), price('Keep')), emptyLock());

    const after = nextLock(manifestOf(price('Keep')), before);

    expect(after.stacks.Shop['Stripe::Price']).toEqual({ Shop_Keep: 'managed', Shop_Old: 'removing' });
  });

  it('keeps a removing key removing while it stays undefined', () => {
    const removing = nextLock(manifestOf(), nextLock(manifestOf(price('Old')), emptyLock()));

    const again = nextLock(manifestOf(), removing);

    expect(again.stacks.Shop['Stripe::Price']).toEqual({ Shop_Old: 'removing' });
  });

  it('makes a removing key managed again when it is defined again', () => {
    const removing = nextLock(manifestOf(), nextLock(manifestOf(price('Old')), emptyLock()));

    const back = nextLock(manifestOf(price('Old')), removing);

    expect(back.stacks.Shop['Stripe::Price']).toEqual({ Shop_Old: 'managed' });
  });

  it('follows a changed lookup key as a removal and an addition', () => {
    const before = nextLock(manifestOf(price('Monthly', { lookup_key: 'monthly_v1' })), emptyLock());

    const after = nextLock(manifestOf(price('Monthly', { lookup_key: 'monthly_v2' })), before);

    expect(after.stacks.Shop['Stripe::Price']).toEqual({ monthly_v1: 'removing', monthly_v2: 'managed' });
  });

  it('does not claim a resource that points at an existing Stripe object by physicalId', () => {
    const lock = nextLock(manifestOf(resource('Stripe::Product', 'External', { name: 'x' }, { physicalId: 'prod_123' })), emptyLock());

    expect(lock.stacks.Shop).toBeUndefined();
  });

  it('leaves the entries of other stacks alone', () => {
    const other: LockFile = { version: 1, stacks: { Other: { 'Stripe::Price': { Other_P: 'managed' } } } };

    const lock = nextLock(manifestOf(price('Monthly')), other);

    expect(lock.stacks.Other).toEqual({ 'Stripe::Price': { Other_P: 'managed' } });
  });

  it('depends only on the definition and the previous lock', () => {
    const resources = [product('Pro'), price('Monthly')];

    const a = nextLock(manifestOf(...resources), emptyLock());
    const b = nextLock(manifestOf(...[...resources].reverse()), emptyLock());

    expect(serializeLock(a)).toBe(serializeLock(b));
  });
});

describe('serializeLock and parseLock', () => {
  it('round-trips a lock', () => {
    const lock = nextLock(manifestOf(product('Pro'), price('Monthly')), emptyLock());

    expect(parseLock(serializeLock(lock))).toEqual(lock);
  });

  it('writes sorted keys and ends with a newline so that diffs stay small', () => {
    const lock = nextLock(manifestOf(price('B'), price('A')), emptyLock());

    const text = serializeLock(lock);

    expect(text.indexOf('Shop_A')).toBeLessThan(text.indexOf('Shop_B'));
    expect(text.endsWith('\n')).toBe(true);
  });

  it('reads a missing lock as an empty one', () => {
    expect(parseLock(undefined)).toEqual(emptyLock());
  });

  it('refuses a lock that is not valid JSON instead of treating it as empty', () => {
    expect(() => parseLock('{ not json')).toThrow(/pricectl\.lock\.json/);
  });

  it('refuses a lock of another version', () => {
    expect(() => parseLock(JSON.stringify({ version: 2, stacks: {} }))).toThrow(/version/);
  });
});

describe('checkFrozenLock', () => {
  it('accepts a lock that is what the definition implies', () => {
    const manifest = manifestOf(price('Monthly'));

    expect(checkFrozenLock(manifest, nextLock(manifest, emptyLock()))).toBeUndefined();
  });

  it('tells the user to run synth when the lock is out of date', () => {
    const message = checkFrozenLock(manifestOf(price('Monthly')), emptyLock());

    expect(message).toContain('pricectl synth');
    expect(message).toContain('pricectl.lock.json');
  });
});
