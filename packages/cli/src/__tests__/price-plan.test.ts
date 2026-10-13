import type Stripe from 'stripe';
import { planPrice, planPriceRemoval, PriceDefinition, PriceObservation } from '../engine/price-plan';
import { asSdkPrice } from './helpers/sdk-shapes';

const STACK = 'Shop';
const PRODUCT = 'prod_A';

function stripePrice(id: string, overrides: Record<string, unknown> = {}): Stripe.Price {
  return asSdkPrice({
    id,
    object: 'price',
    active: true,
    billing_scheme: 'per_unit',
    currency: 'usd',
    lookup_key: 'Shop_Monthly',
    metadata: { pricectl_stack: STACK, pricectl_id: 'Monthly' },
    nickname: null,
    product: PRODUCT,
    recurring: { interval: 'month', interval_count: 1, meter: null, trial_period_days: null, usage_type: 'licensed' },
    tax_behavior: 'unspecified',
    tiers_mode: null,
    transform_quantity: null,
    unit_amount: 1000,
    unit_amount_decimal: '1000',
    ...overrides,
  }) as unknown as Stripe.Price;
}

function definition(overrides: Partial<PriceDefinition> = {}, params: Partial<Stripe.PriceCreateParams> = {}): PriceDefinition {
  return {
    logicalId: 'Monthly',
    key: 'Shop_Monthly',
    isDefault: false,
    params: { product: PRODUCT, currency: 'usd', unit_amount: 1000, recurring: { interval: 'month' }, ...params },
    ...overrides,
  };
}

/** The key holder is the stack's own version, with optional older versions behind it. */
function observed(holder?: Stripe.Price, older: Stripe.Price[] = [], defaults: Record<string, string | null> = {}): PriceObservation {
  return { holder, versions: holder ? [holder, ...older] : [], defaultPriceIds: { [PRODUCT]: null, ...defaults } };
}

const NEW_METADATA = { pricectl_stack: STACK, pricectl_id: 'Monthly' };

describe('planPrice: a slot without a price', () => {
  it('creates the price with the key and the stack tags, without transferring a key', () => {
    const plan = planPrice(STACK, definition(), observed());

    expect(plan.steps).toEqual([
      {
        kind: 'create',
        params: {
          product: PRODUCT,
          currency: 'usd',
          unit_amount: 1000,
          recurring: { interval: 'month' },
          lookup_key: 'Shop_Monthly',
          metadata: NEW_METADATA,
        },
      },
    ]);
  });

  it('uses the lookup key the definition sets instead of the derived key', () => {
    const plan = planPrice(STACK, definition({}, { lookup_key: 'pro_monthly' }), observed());

    expect(plan.steps[0]).toMatchObject({ kind: 'create', params: { lookup_key: 'pro_monthly' } });
  });

  it('makes the new price the product default when the definition declares it', () => {
    const plan = planPrice(STACK, definition({ isDefault: true }), observed());

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'setDefault']);
    expect(plan.steps[1]).toEqual({ kind: 'setDefault', productId: PRODUCT, priceId: null });
  });
});

describe('planPrice: the key holder already matches', () => {
  it('does nothing', () => {
    expect(planPrice(STACK, definition(), observed(stripePrice('price_1'))).steps).toEqual([]);
  });

  it('updates a changed nickname in place', () => {
    const plan = planPrice(STACK, definition({}, { nickname: 'Monthly' }), observed(stripePrice('price_1')));

    expect(plan.steps).toEqual([{ kind: 'update', priceId: 'price_1', changes: { nickname: 'Monthly' } }]);
  });

  it('updates changed user metadata in place and leaves the pricectl tags alone', () => {
    const holder = stripePrice('price_1', { metadata: { ...NEW_METADATA, team: 'old', gone: 'x' } });

    const plan = planPrice(STACK, definition({}, { metadata: { team: 'billing' } }), observed(holder));

    expect(plan.steps).toEqual([
      { kind: 'update', priceId: 'price_1', changes: { metadata: { team: 'billing', gone: '' } } },
    ]);
  });

  it('puts an archived price back on sale in place', () => {
    const plan = planPrice(STACK, definition(), observed(stripePrice('price_1', { active: false })));

    expect(plan.steps).toEqual([{ kind: 'update', priceId: 'price_1', changes: { active: true } }]);
  });

  it('declares the product default when it is not yet', () => {
    const plan = planPrice(STACK, definition({ isDefault: true }), observed(stripePrice('price_1')));

    expect(plan.steps).toEqual([{ kind: 'setDefault', productId: PRODUCT, priceId: 'price_1' }]);
  });

  it('does nothing for a declared default that already is the default', () => {
    const plan = planPrice(STACK, definition({ isDefault: true }), observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }));

    expect(plan.steps).toEqual([]);
  });
});

describe('planPrice: terms that Stripe cannot change', () => {
  const CHANGED = { unit_amount: 2000 };

  it('creates a new version, takes over the key and archives the old version', () => {
    const plan = planPrice(STACK, definition({}, CHANGED), observed(stripePrice('price_1')));

    expect(plan.steps).toEqual([
      {
        kind: 'create',
        params: {
          product: PRODUCT,
          currency: 'usd',
          unit_amount: 2000,
          recurring: { interval: 'month' },
          lookup_key: 'Shop_Monthly',
          transfer_lookup_key: true,
          metadata: { ...NEW_METADATA, pricectl_previous: 'price_1' },
        },
      },
      { kind: 'archive', priceId: 'price_1' },
    ]);
  });

  it('moves the product default to the new version before archiving the old one', () => {
    const plan = planPrice(STACK, definition({}, CHANGED), observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }));

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'setDefault', 'archive']);
    expect(plan.steps[1]).toEqual({ kind: 'setDefault', productId: PRODUCT, priceId: null });
  });

  it('declares the new version as the default when the definition does', () => {
    const plan = planPrice(STACK, definition({ isDefault: true }, CHANGED), observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }));

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'setDefault', 'archive']);
  });

  it('unsets the default instead when the new version is not on sale', () => {
    const plan = planPrice(STACK, definition({}, { ...CHANGED, active: false }), observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }));

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'unsetDefault', 'archive']);
    expect(plan.steps[0]).toMatchObject({ params: { active: false } });
  });

  it('unsets the default of the old product when the price moves to another product', () => {
    const plan = planPrice(
      STACK,
      definition({}, { product: 'prod_B' }),
      { ...observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }), defaultPriceIds: { [PRODUCT]: 'price_1', prod_B: null } },
    );

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'unsetDefault', 'archive']);
    expect(plan.steps[1]).toEqual({ kind: 'unsetDefault', productId: PRODUCT });
  });

  it('does not touch a default price of another product that is not a version of the slot', () => {
    const plan = planPrice(STACK, definition({}, CHANGED), {
      ...observed(stripePrice('price_1')),
      defaultPriceIds: { [PRODUCT]: null, prod_C: 'price_9' },
    });

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'archive']);
  });
});

describe('planPrice: tax behavior', () => {
  it('sets tax behavior in place while the price has none', () => {
    const plan = planPrice(STACK, definition({}, { tax_behavior: 'inclusive' }), observed(stripePrice('price_1')));

    expect(plan.steps).toEqual([{ kind: 'update', priceId: 'price_1', changes: { tax_behavior: 'inclusive' } }]);
  });

  it('creates a new version when tax behavior changes once it is set', () => {
    const holder = stripePrice('price_1', { tax_behavior: 'inclusive' });

    const plan = planPrice(STACK, definition({}, { tax_behavior: 'exclusive' }), observed(holder));

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'archive']);
  });

  it('creates a new version when the definition drops a tax behavior that is set', () => {
    const holder = stripePrice('price_1', { tax_behavior: 'inclusive' });

    const plan = planPrice(STACK, definition(), observed(holder));

    expect(plan.steps.map((s) => s.kind)).toEqual(['create', 'archive']);
  });

  it('keeps a tax behavior that is already what the definition says', () => {
    const holder = stripePrice('price_1', { tax_behavior: 'inclusive' });

    expect(planPrice(STACK, definition({}, { tax_behavior: 'inclusive' }), observed(holder)).steps).toEqual([]);
  });
});

describe('planPrice: taking the lookup key off the product default', () => {
  it('unsets the default before taking a price off sale', () => {
    const plan = planPrice(STACK, definition({}, { active: false }), observed(stripePrice('price_1'), [], { [PRODUCT]: 'price_1' }));

    expect(plan.steps).toEqual([
      { kind: 'unsetDefault', productId: PRODUCT },
      { kind: 'update', priceId: 'price_1', changes: { active: false } },
    ]);
  });
});

describe('planPrice: versions left behind by a failed deploy', () => {
  it('archives an older version that is still on sale while the holder stays', () => {
    const stray = stripePrice('price_0', { lookup_key: null });

    const plan = planPrice(STACK, definition(), observed(stripePrice('price_1'), [stray]));

    expect(plan.steps).toEqual([{ kind: 'archive', priceId: 'price_0' }]);
  });

  it('does not archive an older version that is already off sale', () => {
    const old = stripePrice('price_0', { lookup_key: null, active: false });

    expect(planPrice(STACK, definition(), observed(stripePrice('price_1'), [old])).steps).toEqual([]);
  });

  it('moves the default off a stray version before archiving it', () => {
    const stray = stripePrice('price_0', { lookup_key: null });

    const plan = planPrice(STACK, definition(), observed(stripePrice('price_1'), [stray], { [PRODUCT]: 'price_0' }));

    expect(plan.steps).toEqual([
      { kind: 'setDefault', productId: PRODUCT, priceId: 'price_1' },
      { kind: 'archive', priceId: 'price_0' },
    ]);
  });
});

describe('planPrice: a key held outside the stack', () => {
  const foreign = () => stripePrice('price_x', { metadata: {} });
  const foreignObservation = (): PriceObservation => ({ holder: foreign(), versions: [], defaultPriceIds: { [PRODUCT]: null } });

  it('refuses without transfer_lookup_key and changes nothing', () => {
    const plan = planPrice(STACK, definition(), foreignObservation());

    expect(plan.steps).toEqual([]);
    expect(plan.refusal).toContain('Shop_Monthly');
    expect(plan.refusal).toContain('price_x');
    expect(plan.refusal).toContain('transferLookupKey');
  });

  it('creates the price and takes the key when the definition allows it, leaving the other price on sale', () => {
    const plan = planPrice(STACK, definition({}, { transfer_lookup_key: true }), foreignObservation());

    expect(plan.refusal).toBeUndefined();
    expect(plan.steps).toEqual([
      {
        kind: 'create',
        params: expect.objectContaining({ lookup_key: 'Shop_Monthly', transfer_lookup_key: true, metadata: NEW_METADATA }),
      },
    ]);
  });
});

describe('planPriceRemoval', () => {
  it('archives every version on sale', () => {
    const steps = planPriceRemoval([stripePrice('price_1'), stripePrice('price_0', { active: false }), stripePrice('price_00')], {
      [PRODUCT]: null,
    });

    expect(steps).toEqual([
      { kind: 'archive', priceId: 'price_1' },
      { kind: 'archive', priceId: 'price_00' },
    ]);
  });

  it('unsets the product default before archiving it', () => {
    const steps = planPriceRemoval([stripePrice('price_1')], { [PRODUCT]: 'price_1' });

    expect(steps).toEqual([
      { kind: 'unsetDefault', productId: PRODUCT },
      { kind: 'archive', priceId: 'price_1' },
    ]);
  });
});
