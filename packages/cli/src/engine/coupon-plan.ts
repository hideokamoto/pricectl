import type Stripe from 'stripe';
import { metadataChanges, userMetadata } from './metadata';

/** What the definition says about one coupon. */
export interface CouponDefinition {
  logicalId: string;
  /** `{stackId}_{logicalId}`: the coupon ID pricectl creates it with */
  key: string;
  params: Stripe.CouponCreateParams;
}

/** One change to Stripe for a coupon. */
export type CouponStep =
  | { kind: 'createCoupon'; params: Stripe.CouponCreateParams & { id: string } }
  | { kind: 'updateCoupon'; couponId: string; changes: Stripe.CouponUpdateParams }
  | { kind: 'deleteCoupon'; couponId: string };

export interface CouponPlan {
  steps: CouponStep[];
  /** Why no step may be taken, when the plan has to be refused */
  refusal?: string;
}

/** Coupon fields that Stripe does not allow to change after creation. */
const IMMUTABLE_FIELDS = [
  'duration',
  'amount_off',
  'currency',
  'percent_off',
  'duration_in_months',
  'max_redemptions',
  'redeem_by',
] as const;

/** Compare a coupon field from Stripe (null when unset) with the desired value (undefined when unset). */
function isSameValue(existing: unknown, desired: unknown): boolean {
  return (existing ?? null) === (desired ?? null);
}

/**
 * The steps that bring a coupon in line with its definition. Stripe can only update a coupon's
 * name and metadata, so a change to any other field is refused rather than silently dropped.
 */
export function planCoupon(stackId: string, definition: CouponDefinition, existing: Stripe.Coupon | undefined): CouponPlan {
  const { params } = definition;
  if (!existing) {
    return {
      steps: [
        {
          kind: 'createCoupon',
          params: {
            ...params,
            id: definition.key,
            metadata: {
              ...userMetadata(params.metadata),
              pricectl_stack: stackId,
              pricectl_id: definition.logicalId,
            },
          },
        },
      ],
    };
  }

  const immutable = IMMUTABLE_FIELDS.filter((field) => !isSameValue(existing[field], params[field]));
  if (immutable.length > 0) {
    return {
      steps: [],
      refusal:
        `Coupon "${definition.logicalId}" cannot be updated: Stripe does not allow changing ${immutable.join(', ')}. ` +
        'Give the coupon a new id to create a replacement.',
    };
  }

  const changes: Stripe.CouponUpdateParams = {};
  if (params.name !== undefined && params.name !== existing.name) changes.name = params.name;
  const metadata = metadataChanges(userMetadata(existing.metadata), userMetadata(params.metadata));
  if (Object.keys(metadata).length > 0) changes.metadata = metadata;
  return {
    steps: Object.keys(changes).length > 0 ? [{ kind: 'updateCoupon', couponId: existing.id, changes }] : [],
  };
}

/** The step that removes a coupon; a coupon that is already gone needs nothing. */
export function planCouponRemoval(existing: Stripe.Coupon | undefined): CouponStep[] {
  return existing ? [{ kind: 'deleteCoupon', couponId: existing.id }] : [];
}
