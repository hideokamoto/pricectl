import { Construct, Resource, ResourceProps } from '@pricectl/core';
import { Product } from './product';
import type Stripe from 'stripe';

export interface RecurringProps {
  /**
   * Specifies billing frequency. Either day, week, month or year.
   */
  readonly interval: 'day' | 'week' | 'month' | 'year';

  /**
   * The number of intervals between subscription billings.
   * @default 1
   */
  readonly intervalCount?: number;

  /**
   * Configures how the quantity per period should be determined.
   */
  readonly usageType?: 'metered' | 'licensed';

  /**
   * Default number of trial days when subscribing a customer to this price using trial_from_plan=true.
   */
  readonly trialPeriodDays?: number;
}

export interface PriceProps extends ResourceProps {
  /**
   * The product this price belongs to
   */
  readonly product: Product | string;

  /**
   * Three-letter ISO currency code, in lowercase.
   */
  readonly currency: string;

  /**
   * A positive integer in cents (or 0 for a free price) representing how much to charge.
   */
  readonly unitAmount?: number;

  /**
   * Same as unit_amount, but accepts a decimal value.
   */
  readonly unitAmountDecimal?: string;

  /**
   * Whether the price can be used for new purchases.
   * @default true
   */
  readonly active?: boolean;

  /**
   * A brief description of the price.
   */
  readonly nickname?: string;

  /**
   * The recurring components of a price such as interval and usage_type.
   */
  readonly recurring?: RecurringProps;

  /**
   * Set of key-value pairs that you can attach to an object.
   */
  readonly metadata?: Record<string, string>;

  /**
   * A lookup key used to retrieve prices dynamically from a static string.
   */
  readonly lookupKey?: string;

  /**
   * One of one_time or recurring depending on whether the price is for a one-time purchase or a recurring subscription.
   */
  readonly type?: 'one_time' | 'recurring';

  /**
   * Apply a transformation to the reported usage or set quantity before computing the billed price.
   */
  readonly transformQuantity?: {
    divideBy: number;
    round: 'up' | 'down';
  };

  /**
   * Defines if the tiering price should be graduated or volume based.
   */
  readonly tiersMode?: 'graduated' | 'volume';

  /**
   * Each element represents a pricing tier.
   */
  readonly tiers?: Array<{
    upTo: number | 'inf';
    unitAmount?: number;
    flatAmount?: number;
  }>;
}

/**
 * Represents a Stripe Price
 *
 * @example
 * ```ts
 * const product = new Product(stack, 'MyProduct', {
 *   name: 'Premium Subscription',
 * });
 *
 * new Price(stack, 'MonthlyPrice', {
 *   product,
 *   currency: 'usd',
 *   unitAmount: 1999,
 *   recurring: {
 *     interval: 'month',
 *   },
 * });
 * ```
 */
export class Price extends Resource {
  public readonly product: Product | string;
  public readonly currency: string;
  public readonly unitAmount?: number;
  public readonly unitAmountDecimal?: string;
  public readonly active: boolean;
  public readonly nickname?: string;
  public readonly recurring?: RecurringProps;
  public readonly metadata?: Record<string, string>;
  public readonly lookupKey?: string;
  public readonly type?: 'one_time' | 'recurring';
  public readonly transformQuantity?: {
    divideBy: number;
    round: 'up' | 'down';
  };
  public readonly tiersMode?: 'graduated' | 'volume';
  public readonly tiers?: Array<{
    upTo: number | 'inf';
    unitAmount?: number;
    flatAmount?: number;
  }>;

  constructor(scope: Construct, id: string, props: PriceProps) {
    super(scope, id, props);

    this.product = props.product;
    this.currency = props.currency;
    this.unitAmount = props.unitAmount;
    this.unitAmountDecimal = props.unitAmountDecimal;
    this.active = props.active ?? true;
    this.nickname = props.nickname;
    this.recurring = props.recurring;
    this.metadata = props.metadata;
    this.lookupKey = props.lookupKey;
    this.type = props.type;
    this.transformQuantity = props.transformQuantity;
    this.tiersMode = props.tiersMode;
    this.tiers = props.tiers;

    // Register resource metadata after all properties are initialized
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return 'Stripe::Price';
  }

  protected synthesizeProperties(): Record<string, unknown> {
    const params: Stripe.PriceCreateParams = {
      product: this.product instanceof Product ? this.product.physicalId || this.product.node.id : this.product,
      currency: this.currency,
      active: this.active,
    };

    if (this.unitAmount !== undefined) params.unit_amount = this.unitAmount;
    if (this.unitAmountDecimal !== undefined) params.unit_amount_decimal = this.unitAmountDecimal;
    if (this.nickname !== undefined) params.nickname = this.nickname;
    if (this.metadata !== undefined) params.metadata = this.metadata;
    if (this.lookupKey !== undefined) params.lookup_key = this.lookupKey;
    if (this.tiersMode !== undefined) params.tiers_mode = this.tiersMode;

    // Transform quantity - convert camelCase to snake_case for Stripe API
    if (this.transformQuantity !== undefined) {
      params.transform_quantity = {
        divide_by: this.transformQuantity.divideBy,
        round: this.transformQuantity.round,
      };
    }

    if (this.recurring !== undefined) {
      params.recurring = {
        interval: this.recurring.interval,
        interval_count: this.recurring.intervalCount,
        usage_type: this.recurring.usageType,
        trial_period_days: this.recurring.trialPeriodDays,
      };
    }

    if (Array.isArray(this.tiers) && this.tiers.length > 0) {
      // When tiers are present, billing_scheme must be 'tiered'
      params.billing_scheme = 'tiered';
      params.tiers = this.tiers.map(tier => {
        const tierObj: Stripe.PriceCreateParams.Tier = {
          up_to: tier.upTo,
          unit_amount: tier.unitAmount,
        };
        if (tier.flatAmount !== undefined) {
          tierObj.flat_amount = tier.flatAmount;
        }
        return tierObj;
      });
    }

    return params as unknown as Record<string, unknown>;
  }
}
