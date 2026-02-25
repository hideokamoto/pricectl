import { Stack } from '@pricectl/core';
import { Product } from '../product';
import { Price } from '../price';

describe('Price', () => {
  const API_KEY = 'sk_test_dummy_key_for_testing';

  function createStack(id = 'TestStack'): Stack {
    return new Stack(undefined, id, { apiKey: API_KEY });
  }

  describe('基本的なPrice', () => {
    it('必須プロパティのみで生成できる', () => {
      const stack = createStack();
      const product = new Product(stack, 'Prod', { name: 'Widget' });
      const price = new Price(stack, 'MyPrice', {
        product,
        currency: 'usd',
      });

      expect(price.product).toBe(product);
      expect(price.currency).toBe('usd');
      expect(price.active).toBe(true); // デフォルト値
    });

    it('unitAmountを設定できる', () => {
      const stack = createStack();
      const product = new Product(stack, 'Prod', { name: 'Widget' });
      const price = new Price(stack, 'MyPrice', {
        product,
        currency: 'usd',
        unitAmount: 1999,
      });

      expect(price.unitAmount).toBe(1999);
    });

    it('文字列でproductを参照できる', () => {
      const stack = createStack();
      const price = new Price(stack, 'MyPrice', {
        product: 'prod_existing123',
        currency: 'jpy',
      });

      expect(price.product).toBe('prod_existing123');
    });
  });

  describe('synthesizeProperties（synth経由）', () => {
    it('Productオブジェクト参照時にidが使われる', () => {
      const stack = createStack();
      const product = new Product(stack, 'Prod', { name: 'Widget' });
      new Price(stack, 'MyPrice', {
        product,
        currency: 'usd',
        unitAmount: 1000,
      });

      const manifest = stack.synth();
      const priceResource = manifest.resources.find(r => r.id === 'MyPrice')!;

      // physicalIdがないのでnode.idがfallback
      expect(priceResource.properties.product).toBe('Prod');
      expect(priceResource.properties.currency).toBe('usd');
      expect(priceResource.properties.unit_amount).toBe(1000);
      expect(priceResource.properties.active).toBe(true);
    });

    it('physicalIdがあるProductの場合はphysicalIdが使われる', () => {
      const stack = createStack();
      const product = new Product(stack, 'Prod', {
        name: 'Widget',
        physicalId: 'prod_stripe_123',
      });
      new Price(stack, 'MyPrice', {
        product,
        currency: 'usd',
      });

      const manifest = stack.synth();
      const priceResource = manifest.resources.find(r => r.id === 'MyPrice')!;

      expect(priceResource.properties.product).toBe('prod_stripe_123');
    });

    it('文字列productの場合はそのまま使われる', () => {
      const stack = createStack();
      new Price(stack, 'MyPrice', {
        product: 'prod_existing',
        currency: 'usd',
      });

      const manifest = stack.synth();
      const priceResource = manifest.resources.find(r => r.id === 'MyPrice')!;

      expect(priceResource.properties.product).toBe('prod_existing');
    });

    it('recurringプロパティがsnake_caseに変換される', () => {
      const stack = createStack();
      new Price(stack, 'MonthlyPrice', {
        product: 'prod_123',
        currency: 'usd',
        unitAmount: 999,
        recurring: {
          interval: 'month',
          intervalCount: 1,
          usageType: 'licensed',
          trialPeriodDays: 14,
        },
      });

      const manifest = stack.synth();
      const props = manifest.resources.find(r => r.id === 'MonthlyPrice')!.properties;

      expect(props.recurring).toEqual({
        interval: 'month',
        interval_count: 1,
        usage_type: 'licensed',
        trial_period_days: 14,
      });
    });

    it('tiersが設定された場合にbilling_schemeがtieredになる', () => {
      const stack = createStack();
      new Price(stack, 'TieredPrice', {
        product: 'prod_123',
        currency: 'usd',
        tiersMode: 'graduated',
        tiers: [
          { upTo: 10, unitAmount: 1000 },
          { upTo: 'inf', unitAmount: 800 },
        ],
      });

      const manifest = stack.synth();
      const props = manifest.resources.find(r => r.id === 'TieredPrice')!.properties;

      expect(props.billing_scheme).toBe('tiered');
      expect(props.tiers_mode).toBe('graduated');
      expect(props.tiers).toEqual([
        { up_to: 10, unit_amount: 1000, flat_amount: undefined },
        { up_to: 'inf', unit_amount: 800, flat_amount: undefined },
      ]);
    });

    it('transformQuantityがsnake_caseに変換される', () => {
      const stack = createStack();
      new Price(stack, 'TransformPrice', {
        product: 'prod_123',
        currency: 'usd',
        unitAmount: 500,
        transformQuantity: {
          divideBy: 10,
          round: 'up',
        },
      });

      const manifest = stack.synth();
      const props = manifest.resources.find(r => r.id === 'TransformPrice')!.properties;

      expect(props.transform_quantity).toEqual({
        divide_by: 10,
        round: 'up',
      });
    });

    it('未指定のオプショナルプロパティはpropertiesに含まれない', () => {
      const stack = createStack();
      new Price(stack, 'MinimalPrice', {
        product: 'prod_123',
        currency: 'usd',
      });

      const manifest = stack.synth();
      const props = manifest.resources.find(r => r.id === 'MinimalPrice')!.properties;

      expect(props).not.toHaveProperty('unit_amount');
      expect(props).not.toHaveProperty('unit_amount_decimal');
      expect(props).not.toHaveProperty('nickname');
      expect(props).not.toHaveProperty('recurring');
      expect(props).not.toHaveProperty('metadata');
      expect(props).not.toHaveProperty('lookup_key');
      expect(props).not.toHaveProperty('tiers');
      expect(props).not.toHaveProperty('tiers_mode');
      expect(props).not.toHaveProperty('billing_scheme');
      expect(props).not.toHaveProperty('transform_quantity');
    });

    it('nicknameとlookupKeyが含まれる', () => {
      const stack = createStack();
      new Price(stack, 'NamedPrice', {
        product: 'prod_123',
        currency: 'usd',
        unitAmount: 1000,
        nickname: 'Standard Monthly',
        lookupKey: 'standard_monthly',
        metadata: { plan: 'standard' },
      });

      const manifest = stack.synth();
      const props = manifest.resources.find(r => r.id === 'NamedPrice')!.properties;

      expect(props.nickname).toBe('Standard Monthly');
      expect(props.lookup_key).toBe('standard_monthly');
      expect(props.metadata).toEqual({ plan: 'standard' });
    });
  });

  describe('resourceType', () => {
    it('Stripe::Priceを返す', () => {
      const stack = createStack();
      new Price(stack, 'MyPrice', {
        product: 'prod_123',
        currency: 'usd',
      });

      const manifest = stack.synth();

      expect(manifest.resources[0].type).toBe('Stripe::Price');
    });
  });
});
