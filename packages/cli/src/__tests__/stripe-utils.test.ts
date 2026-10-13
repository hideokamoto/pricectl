import type Stripe from 'stripe';
import { listAttachedFeatures, normalizeResource } from '../engine/stripe-utils';
import { FakeStripe } from './helpers/fake-stripe';
import productFixture from './fixtures/stripe/product.json';

describe('normalizeResource', () => {
  it('leaves out every metadata key pricectl writes itself, so tags never show up as differences', () => {
    const product = {
      ...productFixture,
      metadata: { pricectl_stack: 'Shop', pricectl_id: 'Pro', pricectl_previous: 'price_1', tier: 'pro' },
    } as unknown as Stripe.Product;

    expect(normalizeResource(product, 'Stripe::Product').metadata).toEqual({ tier: 'pro' });
  });

  it('has no metadata when only pricectl tags are left', () => {
    const product = { ...productFixture, metadata: { pricectl_stack: 'Shop' } } as unknown as Stripe.Product;

    expect(normalizeResource(product, 'Stripe::Product')).not.toHaveProperty('metadata');
  });
});

describe('listAttachedFeatures', () => {
  it('maps each attached entitlement feature to the product feature that attaches it', async () => {
    const fake = new FakeStripe();
    const feature = await fake.entitlements.features.create({ name: 'Support', lookup_key: 'support' });
    await fake.products.create({ id: 'Shop_Pro', name: 'Pro' });
    const attached = await fake.products.createFeature('Shop_Pro', { entitlement_feature: feature.id });

    const result = await listAttachedFeatures(fake as unknown as Stripe, 'Shop_Pro');

    expect([...result]).toEqual([[feature.id, attached.id]]);
  });
});
