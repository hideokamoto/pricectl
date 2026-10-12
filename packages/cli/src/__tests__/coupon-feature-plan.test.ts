import type Stripe from 'stripe';
import { planCoupon, planCouponRemoval } from '../engine/coupon-plan';
import { planFeature, planFeatureRemoval } from '../engine/feature-plan';
import couponFixture from './fixtures/stripe/coupon.json';
import featureFixture from './fixtures/stripe/feature.json';

const STACK = 'Shop';

describe('planCoupon', () => {
  const coupon = (overrides: Record<string, unknown> = {}) =>
    ({ ...couponFixture, id: 'Shop_Launch', percent_off: 10, duration: 'once', name: 'Launch', metadata: { pricectl_stack: STACK, pricectl_id: 'Launch' }, amount_off: null, currency: null, duration_in_months: null, max_redemptions: null, redeem_by: null, ...overrides }) as unknown as Stripe.Coupon;
  const definition = (params: Partial<Stripe.CouponCreateParams> = {}) => ({
    logicalId: 'Launch',
    key: 'Shop_Launch',
    params: { percent_off: 10, duration: 'once' as const, name: 'Launch', ...params },
  });

  it('creates a coupon with the derived ID and the stack tags', () => {
    const plan = planCoupon(STACK, definition(), undefined);

    expect(plan.steps).toEqual([
      {
        kind: 'createCoupon',
        params: { id: 'Shop_Launch', percent_off: 10, duration: 'once', name: 'Launch', metadata: { pricectl_stack: STACK, pricectl_id: 'Launch' } },
      },
    ]);
  });

  it('does nothing when the coupon matches', () => {
    expect(planCoupon(STACK, definition(), coupon()).steps).toEqual([]);
  });

  it('updates the name and the metadata in place', () => {
    const plan = planCoupon(STACK, definition({ name: 'Launch 2', metadata: { campaign: 'x' } }), coupon());

    expect(plan.steps).toEqual([
      { kind: 'updateCoupon', couponId: 'Shop_Launch', changes: { name: 'Launch 2', metadata: { campaign: 'x' } } },
    ]);
  });

  it('refuses a change to a field Stripe cannot change and names it', () => {
    const plan = planCoupon(STACK, definition({ percent_off: 25 }), coupon());

    expect(plan.steps).toEqual([]);
    expect(plan.refusal).toContain('percent_off');
    expect(plan.refusal).toContain('Launch');
  });
});

describe('planCouponRemoval', () => {
  it('deletes the coupon', () => {
    expect(planCouponRemoval({ id: 'Shop_Launch' } as Stripe.Coupon)).toEqual([{ kind: 'deleteCoupon', couponId: 'Shop_Launch' }]);
  });

  it('does nothing when there is no coupon', () => {
    expect(planCouponRemoval(undefined)).toEqual([]);
  });
});

describe('planFeature', () => {
  const feature = (overrides: Record<string, unknown> = {}) =>
    ({ ...featureFixture, id: 'feat_1', name: 'Support', lookup_key: 'support', active: true, metadata: { pricectl_stack: STACK, pricectl_id: 'Support' }, ...overrides }) as unknown as Stripe.Entitlements.Feature;
  const definition = (params: Partial<Stripe.Entitlements.FeatureCreateParams> = {}) => ({
    logicalId: 'Support',
    key: 'support',
    params: { name: 'Support', lookup_key: 'support', ...params },
  });

  it('creates a feature with the stack tags', () => {
    const plan = planFeature(STACK, definition(), undefined);

    expect(plan.steps).toEqual([
      { kind: 'createFeature', params: { name: 'Support', lookup_key: 'support', metadata: { pricectl_stack: STACK, pricectl_id: 'Support' } } },
    ]);
  });

  it('does nothing when the feature matches', () => {
    expect(planFeature(STACK, definition(), feature()).steps).toEqual([]);
  });

  it('updates the name and the metadata of the active feature in place', () => {
    const plan = planFeature(STACK, definition({ name: 'Priority support' }), feature());

    expect(plan.steps).toEqual([{ kind: 'updateFeature', featureId: 'feat_1', changes: { name: 'Priority support' } }]);
  });

  it('refuses an inactive feature, which Stripe does not let you update', () => {
    const plan = planFeature(STACK, definition(), feature({ active: false }));

    expect(plan.steps).toEqual([]);
    expect(plan.refusal).toContain('feat_1');
  });
});

describe('planFeatureRemoval', () => {
  it('deactivates an active feature', () => {
    expect(planFeatureRemoval({ id: 'feat_1', active: true } as Stripe.Entitlements.Feature)).toEqual([
      { kind: 'deactivateFeature', featureId: 'feat_1' },
    ]);
  });

  it('does nothing for an inactive feature or none at all', () => {
    expect(planFeatureRemoval({ id: 'feat_1', active: false } as Stripe.Entitlements.Feature)).toEqual([]);
    expect(planFeatureRemoval(undefined)).toEqual([]);
  });
});
