import Stripe from 'stripe';
import { fetchCurrentResource } from '../engine/stripe-utils';
import { FakeStripe } from './helpers/fake-stripe';
import productFixture from './fixtures/stripe/product.json';
import meterFixture from './fixtures/stripe/meter.json';
import featureFixture from './fixtures/stripe/feature.json';

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

  it('does not ask Stripe for attached features when the product does not set features', async () => {
    const fake = new FakeStripe();
    fake.seed('products', productFixture);
    const listFeatures = jest.spyOn(fake.products, 'listFeatures');

    const current = await fetchCurrentResource(fake as unknown as Stripe, {
      type: 'Stripe::Product',
      id: 'FxProd',
      physicalId: productFixture.id,
      properties: { name: 'Widget' },
    });

    expect(current).not.toHaveProperty('features');
    expect(listFeatures).not.toHaveBeenCalled();
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
      properties: { name: 'Widget', features: [feature.id] },
    });

    expect(current).toMatchObject({ features: [feature.id] });
  });

  it.each([
    ['Stripe::BillingMeter', 'meters', meterFixture],
    ['Stripe::EntitlementFeature', 'features', featureFixture],
  ] as const)('returns the %s named by physicalId, as deploy uses it', async (type, store, fixture) => {
    const fake = new FakeStripe();
    fake.seed(store, fixture);

    const current = await fetchCurrentResource(fake as unknown as Stripe, { type, id: 'Adopted', physicalId: fixture.id });

    expect(current).toMatchObject({ id: fixture.id });
  });
});
