import { checkManifest } from '../manifest-checks';
import { ResourceManifest, StackManifest } from '../stack';
import { Stack } from '../stack';
import { TestResource } from './helpers';

function price(id: string, properties: Record<string, unknown>, isDefault = false): ResourceManifest {
  return {
    id,
    key: `Shop_${id}`,
    path: `Shop/${id}`,
    type: 'Stripe::Price',
    properties: { product: 'Prod', currency: 'usd', active: true, ...properties },
    ...(isDefault ? { isDefault } : {}),
  };
}

function manifestOf(...resources: ResourceManifest[]): StackManifest {
  return { stackId: 'Shop', tags: {}, resources };
}

describe('checkManifest', () => {
  it('reports nothing for a consistent definition', () => {
    const problems = checkManifest(
      manifestOf(price('Monthly', { lookup_key: 'monthly' }, true), price('Yearly', { lookup_key: 'yearly' })),
    );

    expect(problems).toEqual([]);
  });

  describe('lookup keys', () => {
    it('reports two prices that set the same lookup key', () => {
      const problems = checkManifest(
        manifestOf(price('A', { lookup_key: 'pro' }), price('B', { lookup_key: 'pro' })),
      );

      expect(problems).toEqual([
        'Prices "Shop/A" and "Shop/B" both use the lookup key "pro". A lookup key belongs to one price.',
      ]);
    });

    it('reports a price whose explicit lookup key equals the derived key of another price', () => {
      const problems = checkManifest(manifestOf(price('A', { lookup_key: 'Shop_B' }), price('B', {})));

      expect(problems).toEqual([
        'Prices "Shop/A" and "Shop/B" both use the lookup key "Shop_B". A lookup key belongs to one price.',
      ]);
    });

    it('does not compare a price lookup key with an entitlement feature lookup key', () => {
      const feature: ResourceManifest = {
        id: 'F',
        key: 'Shop_F',
        path: 'Shop/F',
        type: 'Stripe::EntitlementFeature',
        properties: { name: 'F', lookup_key: 'pro' },
      };

      const problems = checkManifest(manifestOf(price('A', { lookup_key: 'pro' }), feature));

      expect(problems).toEqual([]);
    });
  });

  describe('features and meters', () => {
    const feature = (id: string, lookupKey: string): ResourceManifest => ({
      id,
      key: `Shop_${id}`,
      path: `Shop/${id}`,
      type: 'Stripe::EntitlementFeature',
      properties: { name: id, lookup_key: lookupKey },
    });
    const meter = (id: string, eventName: string): ResourceManifest => ({
      id,
      key: `Shop_${id}`,
      path: `Shop/${id}`,
      type: 'Stripe::BillingMeter',
      properties: { display_name: id, event_name: eventName },
    });

    it('reports two features with the same lookup key', () => {
      expect(checkManifest(manifestOf(feature('A', 'support'), feature('B', 'support')))).toEqual([
        'Features "Shop/A" and "Shop/B" both use the lookup key "support". A lookup key belongs to one feature.',
      ]);
    });

    it('reports two meters with the same event name', () => {
      expect(checkManifest(manifestOf(meter('A', 'calls'), meter('B', 'calls')))).toEqual([
        'Meters "Shop/A" and "Shop/B" both use the event name "calls". An event name belongs to one active meter.',
      ]);
    });

    it('accepts different keys and event names', () => {
      expect(checkManifest(manifestOf(feature('A', 'a'), feature('B', 'b'), meter('A2', 'x'), meter('B2', 'y')))).toEqual([]);
    });
  });

  describe('default prices', () => {
    it('reports two default prices for one product', () => {
      const problems = checkManifest(manifestOf(price('A', {}, true), price('B', {}, true)));

      expect(problems).toEqual([
        'Prices "Shop/A" and "Shop/B" are both declared as the default price of product "Prod". A product has one default price.',
      ]);
    });

    it('accepts one default price for each of two products', () => {
      const problems = checkManifest(
        manifestOf(price('A', { product: 'P1' }, true), price('B', { product: 'P2' }, true)),
      );

      expect(problems).toEqual([]);
    });

    it('reports a default price that is not on sale', () => {
      const problems = checkManifest(manifestOf(price('A', { active: false }, true)));

      expect(problems).toEqual([
        'Price "Shop/A" is declared as a default price but has active: false. A default price must be on sale.',
      ]);
    });
  });

  it('reports every problem at once', () => {
    const problems = checkManifest(
      manifestOf(price('A', { lookup_key: 'pro', active: false }, true), price('B', { lookup_key: 'pro' }, true)),
    );

    expect(problems).toHaveLength(3);
  });
});

describe('Stack.synth', () => {
  it('throws with the problems of the definition', () => {
    const stack = new Stack(undefined, 'Shop', { apiKey: 'sk_test_dummy_key_for_testing' });
    new TestResource(stack, 'A', { type: 'Stripe::Price', properties: { product: 'P', lookup_key: 'pro' } });
    new TestResource(stack, 'B', { type: 'Stripe::Price', properties: { product: 'P', lookup_key: 'pro' } });

    expect(() => stack.synth()).toThrow(/both use the lookup key "pro"/);
  });
});
