import { Construct, Resource, ResourceProps } from '@pricectl/core';
import type Stripe from 'stripe';

export interface CouponProps extends ResourceProps {
  /**
   * Specifies how long the discount will be in effect if used on a subscription.
   */
  readonly duration: 'forever' | 'once' | 'repeating';

  /**
   * A positive integer representing the amount to subtract from an invoice total.
   */
  readonly amountOff?: number;

  /**
   * Three-letter ISO code for the currency of the amount_off parameter.
   */
  readonly currency?: string;

  /**
   * A positive float larger than 0, and smaller or equal to 100, that represents the discount the coupon will apply.
   */
  readonly percentOff?: number;

  /**
   * Required only if duration is repeating. Number of months the coupon applies.
   */
  readonly durationInMonths?: number;

  /**
   * Maximum number of times this coupon can be redeemed, in total, across all customers, before it is no longer valid.
   */
  readonly maxRedemptions?: number;

  /**
   * Set of key-value pairs that you can attach to an object.
   */
  readonly metadata?: Record<string, string>;

  /**
   * Name of the coupon displayed to customers.
   */
  readonly name?: string;

  /**
   * Unix timestamp specifying the last time at which the coupon can be redeemed.
   */
  readonly redeemBy?: number;

  /**
   * Determines which product or price IDs this coupon applies to.
   */
  readonly appliesTo?: {
    products?: string[];
  };
}

/**
 * Represents a Stripe Coupon
 *
 * @example
 * ```ts
 * new Coupon(stack, 'SummerSale', {
 *   percentOff: 20,
 *   duration: 'repeating',
 *   durationInMonths: 3,
 *   name: 'Summer Sale 2024',
 * });
 * ```
 */
export class Coupon extends Resource {
  public readonly duration: 'forever' | 'once' | 'repeating';
  public readonly amountOff?: number;
  public readonly currency?: string;
  public readonly percentOff?: number;
  public readonly durationInMonths?: number;
  public readonly maxRedemptions?: number;
  public readonly metadata?: Record<string, string>;
  public readonly name?: string;
  public readonly redeemBy?: number;
  public readonly appliesTo?: {
    products?: string[];
  };

  constructor(scope: Construct, id: string, props: CouponProps) {
    super(scope, id, props);

    this.duration = props.duration;
    this.amountOff = props.amountOff;
    this.currency = props.currency;
    this.percentOff = props.percentOff;
    this.durationInMonths = props.durationInMonths;
    this.maxRedemptions = props.maxRedemptions;
    this.metadata = props.metadata;
    this.name = props.name;
    this.redeemBy = props.redeemBy;
    this.appliesTo = props.appliesTo;

    // Validation: Exactly one of amountOff or percentOff must be provided (XOR)
    const hasAmountOff = this.amountOff !== undefined;
    const hasPercentOff = this.percentOff !== undefined;
    if (hasAmountOff === hasPercentOff) {
      throw new Error('Exactly one of amountOff or percentOff must be specified');
    }

    if (this.duration === 'repeating' && this.durationInMonths === undefined) {
      throw new Error('durationInMonths is required when duration is "repeating"');
    }

    if (this.amountOff !== undefined && this.currency === undefined) {
      throw new Error('currency is required when amountOff is specified');
    }

    // Register resource metadata after all properties are initialized
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return 'Stripe::Coupon';
  }

  protected synthesizeProperties(): Stripe.CouponCreateParams {
    const params: Stripe.CouponCreateParams = {
      duration: this.duration,
    };

    if (this.amountOff !== undefined) params.amount_off = this.amountOff;
    if (this.currency !== undefined) params.currency = this.currency;
    if (this.percentOff !== undefined) params.percent_off = this.percentOff;
    if (this.durationInMonths !== undefined) params.duration_in_months = this.durationInMonths;
    if (this.maxRedemptions !== undefined) params.max_redemptions = this.maxRedemptions;
    if (this.metadata !== undefined) params.metadata = this.metadata;
    if (this.name !== undefined) params.name = this.name;
    if (this.redeemBy !== undefined) params.redeem_by = this.redeemBy;
    if (this.appliesTo !== undefined) params.applies_to = this.appliesTo;

    return params;
  }
}
