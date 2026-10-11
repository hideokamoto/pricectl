import Stripe from 'stripe';
import { fetchCurrentResource } from '../engine/stripe-utils';
import { FakeStripe } from './helpers/fake-stripe';
import productFixture from './fixtures/stripe/product.json';

describe('fetchCurrentResource', () => {
  it('returns the product named by physicalId, as deploy adopts it', async () => {
    const fake = new FakeStripe();
    fake.seed('products', { ...productFixture, id: 'prod_unmanaged', metadata: {} });

    const current = await fetchCurrentResource(fake as unknown as Stripe, {
      type: 'Stripe::Product',
      id: 'Adopted',
      physicalId: 'prod_unmanaged',
    });

    expect(current).toMatchObject({ id: 'prod_unmanaged' });
  });

  it('includes the IDs of the entitlement features attached to a product', async () => {
    const fake = new FakeStripe();
    fake.seed('products', productFixture);
    const feature = await fake.entitlements.features.create({ name: 'Support', lookup_key: 'support' });
    await fake.products.createFeature(productFixture.id, { entitlement_feature: feature.id });

    const current = await fetchCurrentResource(fake as unknown as Stripe, {
      type: 'Stripe::Product',
      id: 'FxProd',
      physicalId: productFixture.id,
    });

    expect(current).toMatchObject({ features: [feature.id] });
  });
});
