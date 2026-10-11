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
});
