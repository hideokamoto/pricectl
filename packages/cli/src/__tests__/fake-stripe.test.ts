import { FakeStripe } from './helpers/fake-stripe';

/** The fake reproduces behavior observed in Stripe test mode (design/price-revision/verify_*.result.txt). */
describe('FakeStripe', () => {
  let stripe: FakeStripe;

  beforeEach(() => {
    stripe = new FakeStripe();
  });

  describe('product IDs chosen by the caller', () => {
    it('creates a product with the given ID', async () => {
      const product = await stripe.products.create({ id: 'Shop_Pro', name: 'Pro' });

      expect(product.id).toBe('Shop_Pro');
    });

    it('rejects a second product with the same ID', async () => {
      await stripe.products.create({ id: 'Shop_Pro', name: 'Pro' });

      await expect(stripe.products.create({ id: 'Shop_Pro', name: 'Pro' })).rejects.toMatchObject({ code: 'resource_already_exists' });
    });

    it('rejects an ID with characters outside [A-Za-z0-9_-]', async () => {
      await expect(stripe.products.create({ id: 'Shop.Pro', name: 'Pro' })).rejects.toThrow(/match the regex pattern/);
    });

    it('rejects an ID longer than 200 characters', async () => {
      await expect(stripe.products.create({ id: 'x'.repeat(201), name: 'Pro' })).rejects.toThrow(/at most 200 characters/);
    });

    it('lets a deleted product ID be used again', async () => {
      await stripe.products.create({ id: 'Shop_Pro', name: 'Pro' });
      await stripe.products.del('Shop_Pro');

      await expect(stripe.products.create({ id: 'Shop_Pro', name: 'Pro' })).resolves.toMatchObject({ id: 'Shop_Pro' });
    });
  });

  describe('default price', () => {
    async function productWithPrice() {
      await stripe.products.create({ id: 'Shop_Pro', name: 'Pro' });
      const price = await stripe.prices.create({ product: 'Shop_Pro', currency: 'usd', unit_amount: 100 });
      return price;
    }

    it('sets a default price of the product', async () => {
      const price = await productWithPrice();

      const product = await stripe.products.update('Shop_Pro', { default_price: price.id });

      expect(product.default_price).toBe(price.id);
    });

    it('refuses to archive the default price', async () => {
      const price = await productWithPrice();
      await stripe.products.update('Shop_Pro', { default_price: price.id });

      await expect(stripe.prices.update(price.id, { active: false })).rejects.toThrow(
        'This price cannot be archived because it is the default price of its product.',
      );
    });

    it('lets the default price be archived once it is unset with an empty string', async () => {
      const price = await productWithPrice();
      await stripe.products.update('Shop_Pro', { default_price: price.id });
      await stripe.products.update('Shop_Pro', { default_price: '' });

      await expect(stripe.prices.update(price.id, { active: false })).resolves.toMatchObject({ active: false });
    });

    it('refuses an archived price as the default price', async () => {
      const price = await productWithPrice();
      await stripe.prices.update(price.id, { active: false });

      await expect(stripe.products.update('Shop_Pro', { default_price: price.id })).rejects.toThrow();
    });

    it('refuses a price of another product as the default price', async () => {
      const price = await productWithPrice();
      await stripe.products.create({ id: 'Shop_Other', name: 'Other' });

      await expect(stripe.products.update('Shop_Other', { default_price: price.id })).rejects.toThrow(/belongs to a different product/);
    });
  });

  describe('price lookup keys', () => {
    it('lists the holders of the given lookup keys, active or not', async () => {
      await stripe.products.create({ id: 'Shop_Pro', name: 'Pro' });
      const a = await stripe.prices.create({ product: 'Shop_Pro', currency: 'usd', unit_amount: 1, lookup_key: 'a' });
      await stripe.prices.update(a.id, { active: false });
      await stripe.prices.create({ product: 'Shop_Pro', currency: 'usd', unit_amount: 1, lookup_key: 'b' });

      const page = await stripe.prices.list({ lookup_keys: ['a', 'zzz'] });

      expect(page.data.map((x) => x.id)).toEqual([a.id]);
    });

    it('refuses more than 10 lookup keys in one list call', async () => {
      const keys = Array.from({ length: 11 }, (_, i) => `k${i}`);

      await expect(stripe.prices.list({ lookup_keys: keys })).rejects.toThrow('Array lookup_keys exceeded maximum 10 allowed elements.');
    });
  });

  describe('entitlement features', () => {
    it('rejects a second active feature with the same lookup key', async () => {
      await stripe.entitlements.features.create({ name: 'A', lookup_key: 'k' });

      await expect(stripe.entitlements.features.create({ name: 'B', lookup_key: 'k' })).rejects.toThrow(/already using the feature lookup_key/);
    });

    it('allows the lookup key again after the feature was deactivated', async () => {
      const first = await stripe.entitlements.features.create({ name: 'A', lookup_key: 'k' });
      await stripe.entitlements.features.update(first.id, { active: false });

      await expect(stripe.entitlements.features.create({ name: 'B', lookup_key: 'k' })).resolves.toMatchObject({ active: true });
    });

    it('lists features by lookup key, and only the active ones with archived: false', async () => {
      const first = await stripe.entitlements.features.create({ name: 'A', lookup_key: 'k' });
      await stripe.entitlements.features.update(first.id, { active: false });
      const second = await stripe.entitlements.features.create({ name: 'B', lookup_key: 'k' });

      const all = await stripe.entitlements.features.list({ lookup_key: 'k' });
      const active = await stripe.entitlements.features.list({ lookup_key: 'k', archived: false });

      expect(all.data).toHaveLength(2);
      expect(active.data.map((x) => x.id)).toEqual([second.id]);
    });
  });

  describe('billing meters', () => {
    const params = { display_name: 'Calls', event_name: 'api_calls', default_aggregation: { formula: 'count' } };

    it('rejects a second active meter with the same event name', async () => {
      await stripe.billing.meters.create(params);

      await expect(stripe.billing.meters.create(params)).rejects.toThrow("An active meter already exists for event name 'api_calls'");
    });

    it('allows the event name again after the meter was deactivated', async () => {
      const first = await stripe.billing.meters.create(params);
      await stripe.billing.meters.deactivate(first.id);

      await expect(stripe.billing.meters.create(params)).resolves.toMatchObject({ status: 'active' });
    });

    it('refuses to reactivate a meter while another is active with its event name', async () => {
      const first = await stripe.billing.meters.create(params);
      await stripe.billing.meters.deactivate(first.id);
      await stripe.billing.meters.create(params);

      await expect(stripe.billing.meters.reactivate(first.id)).rejects.toThrow(/cannot be reactivated/);
    });

    it('lists only the active meters with status: active', async () => {
      const first = await stripe.billing.meters.create(params);
      await stripe.billing.meters.deactivate(first.id);
      const second = await stripe.billing.meters.create(params);

      const page = await stripe.billing.meters.list({ status: 'active' });

      expect(page.data.map((x) => x.id)).toEqual([second.id]);
    });
  });
});
