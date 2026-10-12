import type Stripe from 'stripe';
import { planProduct, planProductRemoval, ProductDefinition, ProductObservation } from '../engine/product-plan';
import productFixture from './fixtures/stripe/product.json';

const STACK = 'Shop';

const stripeProduct = (overrides: Record<string, unknown> = {}) =>
  ({ ...productFixture, id: 'Shop_Pro', name: 'Pro', active: true, metadata: { pricectl_stack: STACK, pricectl_id: 'Pro' }, ...overrides }) as unknown as Stripe.Product;

const definition = (params: Partial<Stripe.ProductCreateParams> = {}, extra: Partial<ProductDefinition> = {}): ProductDefinition => ({
  logicalId: 'Pro',
  key: 'Shop_Pro',
  params: { name: 'Pro', active: true, ...params },
  ...extra,
});

const observed = (product?: Stripe.Product, attached: Array<[string, string]> = []): ProductObservation => ({
  product,
  attachedFeatures: new Map(attached),
});

describe('planProduct', () => {
  it('creates a product with the derived ID and the stack tags', () => {
    const steps = planProduct(STACK, definition({ description: 'Pro plan' }), observed());

    expect(steps).toEqual([
      {
        kind: 'createProduct',
        params: {
          id: 'Shop_Pro',
          name: 'Pro',
          active: true,
          description: 'Pro plan',
          metadata: { pricectl_stack: STACK, pricectl_id: 'Pro' },
        },
      },
    ]);
  });

  it('attaches the features of a new product after creating it', () => {
    const steps = planProduct(STACK, definition({}, { desiredFeatureIds: ['feat_1', 'feat_2'] }), observed());

    expect(steps.map((s) => s.kind)).toEqual(['createProduct', 'attachFeature', 'attachFeature']);
    expect(steps[1]).toEqual({ kind: 'attachFeature', productId: 'Shop_Pro', featureId: 'feat_1' });
  });

  it('does nothing when the product matches', () => {
    expect(planProduct(STACK, definition(), observed(stripeProduct()))).toEqual([]);
  });

  it('updates only the fields that changed', () => {
    const steps = planProduct(STACK, definition({ name: 'Pro Plus', description: 'New' }), observed(stripeProduct({ description: 'Old' })));

    expect(steps).toEqual([{ kind: 'updateProduct', productId: 'Shop_Pro', changes: { name: 'Pro Plus', description: 'New' } }]);
  });

  it('brings an archived product back on sale', () => {
    const steps = planProduct(STACK, definition(), observed(stripeProduct({ active: false })));

    expect(steps).toEqual([{ kind: 'updateProduct', productId: 'Shop_Pro', changes: { active: true } }]);
  });

  it('leaves fields the definition does not set alone', () => {
    const steps = planProduct(STACK, definition(), observed(stripeProduct({ description: 'Set in the Dashboard', url: 'https://x' })));

    expect(steps).toEqual([]);
  });

  it('updates changed user metadata and keeps the pricectl tags', () => {
    const existing = stripeProduct({ metadata: { pricectl_stack: STACK, pricectl_id: 'Pro', tier: 'old', gone: 'x' } });

    const steps = planProduct(STACK, definition({ metadata: { tier: 'pro' } }), observed(existing));

    expect(steps).toEqual([{ kind: 'updateProduct', productId: 'Shop_Pro', changes: { metadata: { tier: 'pro', gone: '' } } }]);
  });

  describe('features', () => {
    it('attaches features that are missing', () => {
      const steps = planProduct(STACK, definition({}, { desiredFeatureIds: ['feat_1', 'feat_2'] }), observed(stripeProduct(), [['feat_1', 'pf_1']]));

      expect(steps).toEqual([{ kind: 'attachFeature', productId: 'Shop_Pro', featureId: 'feat_2' }]);
    });

    it('detaches features that are no longer listed', () => {
      const steps = planProduct(STACK, definition({}, { desiredFeatureIds: ['feat_1'] }), observed(stripeProduct(), [['feat_1', 'pf_1'], ['feat_9', 'pf_9']]));

      expect(steps).toEqual([{ kind: 'detachFeature', productId: 'Shop_Pro', productFeatureId: 'pf_9' }]);
    });

    it('detaches every feature when the definition lists none', () => {
      const steps = planProduct(STACK, definition({}, { desiredFeatureIds: [] }), observed(stripeProduct(), [['feat_1', 'pf_1']]));

      expect(steps).toEqual([{ kind: 'detachFeature', productId: 'Shop_Pro', productFeatureId: 'pf_1' }]);
    });

    it('leaves attachments alone when the definition does not manage features', () => {
      expect(planProduct(STACK, definition(), observed(stripeProduct(), [['feat_1', 'pf_1']]))).toEqual([]);
    });
  });
});

describe('planProductRemoval', () => {
  it('deletes a product without prices', () => {
    expect(planProductRemoval(stripeProduct(), false)).toEqual([{ kind: 'deleteProduct', productId: 'Shop_Pro' }]);
  });

  it('archives a product that has prices, because Stripe refuses to delete it', () => {
    expect(planProductRemoval(stripeProduct(), true)).toEqual([{ kind: 'archiveProduct', productId: 'Shop_Pro' }]);
  });

  it('does nothing for a product that is already archived', () => {
    expect(planProductRemoval(stripeProduct({ active: false }), true)).toEqual([]);
  });
});
