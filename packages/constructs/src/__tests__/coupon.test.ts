import { Coupon } from '../coupon';
import { createStack } from './helpers';

describe('Coupon', () => {

  describe('バリデーション', () => {
    it('amountOffとpercentOffの両方が指定された場合はエラー', () => {
      const stack = createStack();

      expect(
        () =>
          new Coupon(stack, 'Bad', {
            duration: 'once',
            amountOff: 500,
            percentOff: 10,
            currency: 'usd',
          })
      ).toThrow('Exactly one of amountOff or percentOff must be specified');
    });

    it('amountOffもpercentOffも指定されていない場合はエラー', () => {
      const stack = createStack();

      expect(
        () =>
          new Coupon(stack, 'Bad', {
            duration: 'once',
          })
      ).toThrow('Exactly one of amountOff or percentOff must be specified');
    });

    it('duration=repeatingでdurationInMonthsが未指定の場合はエラー', () => {
      const stack = createStack();

      expect(
        () =>
          new Coupon(stack, 'Bad', {
            duration: 'repeating',
            percentOff: 10,
          })
      ).toThrow('durationInMonths is required when duration is "repeating"');
    });

    it('amountOff指定時にcurrencyが未指定の場合はエラー', () => {
      const stack = createStack();

      expect(
        () =>
          new Coupon(stack, 'Bad', {
            duration: 'once',
            amountOff: 500,
          })
      ).toThrow('currency is required when amountOff is specified');
    });
  });

  describe('正常な生成', () => {
    it('percentOffでonce couponを生成できる', () => {
      const stack = createStack();
      const coupon = new Coupon(stack, 'Sale', {
        duration: 'once',
        percentOff: 20,
      });

      expect(coupon.duration).toBe('once');
      expect(coupon.percentOff).toBe(20);
      expect(coupon.amountOff).toBeUndefined();
    });

    it('amountOffでforever couponを生成できる', () => {
      const stack = createStack();
      const coupon = new Coupon(stack, 'Discount', {
        duration: 'forever',
        amountOff: 500,
        currency: 'usd',
      });

      expect(coupon.duration).toBe('forever');
      expect(coupon.amountOff).toBe(500);
      expect(coupon.currency).toBe('usd');
    });

    it('repeating couponを生成できる', () => {
      const stack = createStack();
      const coupon = new Coupon(stack, 'Promo', {
        duration: 'repeating',
        percentOff: 15,
        durationInMonths: 3,
      });

      expect(coupon.duration).toBe('repeating');
      expect(coupon.durationInMonths).toBe(3);
    });

    it('すべてのオプショナルプロパティを設定できる', () => {
      const stack = createStack();
      const coupon = new Coupon(stack, 'FullCoupon', {
        duration: 'repeating',
        percentOff: 25,
        durationInMonths: 6,
        maxRedemptions: 100,
        metadata: { campaign: 'summer' },
        name: 'Summer Sale',
        redeemBy: 1735689600,
        appliesTo: { products: ['prod_123'] },
      });

      expect(coupon.maxRedemptions).toBe(100);
      expect(coupon.metadata).toEqual({ campaign: 'summer' });
      expect(coupon.name).toBe('Summer Sale');
      expect(coupon.redeemBy).toBe(1735689600);
      expect(coupon.appliesTo).toEqual({ products: ['prod_123'] });
    });
  });

  describe('synthesizeProperties（synth経由）', () => {
    it('percentOff couponのpropertiesが正しい', () => {
      const stack = createStack();
      new Coupon(stack, 'Sale', {
        duration: 'once',
        percentOff: 20,
        name: 'Flash Sale',
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.duration).toBe('once');
      expect(props.percent_off).toBe(20);
      expect(props.name).toBe('Flash Sale');
      expect(props).not.toHaveProperty('amount_off');
      expect(props).not.toHaveProperty('currency');
    });

    it('amountOff couponのpropertiesが正しい', () => {
      const stack = createStack();
      new Coupon(stack, 'Discount', {
        duration: 'forever',
        amountOff: 1000,
        currency: 'jpy',
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.duration).toBe('forever');
      expect(props.amount_off).toBe(1000);
      expect(props.currency).toBe('jpy');
      expect(props).not.toHaveProperty('percent_off');
    });

    it('repeating couponでduration_in_monthsが含まれる', () => {
      const stack = createStack();
      new Coupon(stack, 'Promo', {
        duration: 'repeating',
        percentOff: 10,
        durationInMonths: 12,
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.duration_in_months).toBe(12);
    });

    it('すべてのオプショナルプロパティがsnake_caseで含まれる', () => {
      const stack = createStack();
      new Coupon(stack, 'Full', {
        duration: 'once',
        percentOff: 50,
        maxRedemptions: 200,
        metadata: { source: 'api' },
        name: 'Big Sale',
        redeemBy: 1735689600,
        appliesTo: { products: ['prod_abc'] },
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.max_redemptions).toBe(200);
      expect(props.metadata).toEqual({ source: 'api' });
      expect(props.name).toBe('Big Sale');
      expect(props.redeem_by).toBe(1735689600);
      expect(props.applies_to).toEqual({ products: ['prod_abc'] });
    });

    it('未指定のオプショナルプロパティはpropertiesに含まれない', () => {
      const stack = createStack();
      new Coupon(stack, 'Minimal', {
        duration: 'once',
        percentOff: 5,
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props).not.toHaveProperty('amount_off');
      expect(props).not.toHaveProperty('currency');
      expect(props).not.toHaveProperty('duration_in_months');
      expect(props).not.toHaveProperty('max_redemptions');
      expect(props).not.toHaveProperty('metadata');
      expect(props).not.toHaveProperty('name');
      expect(props).not.toHaveProperty('redeem_by');
      expect(props).not.toHaveProperty('applies_to');
    });
  });

  describe('resourceType', () => {
    it('Stripe::Couponを返す', () => {
      const stack = createStack();
      new Coupon(stack, 'MyCoupon', {
        duration: 'once',
        percentOff: 10,
      });

      const manifest = stack.synth();

      expect(manifest.resources[0].type).toBe('Stripe::Coupon');
    });
  });
});
