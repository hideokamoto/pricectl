import { Construct, Resource, ResourceProps } from '@pricectl/core';
import type Stripe from 'stripe';

export interface EntitlementFeatureProps extends ResourceProps {
  /**
   * The feature's name, for your own purpose, not meant to be displayable to the customer.
   */
  readonly name: string;

  /**
   * A unique key you provide as your own system identifier. This may be up to 80 characters.
   */
  readonly lookupKey: string;

  /**
   * Set of key-value pairs that you can attach to an object.
   */
  readonly metadata?: Record<string, string>;
}

/**
 * Represents a Stripe Entitlements Feature
 *
 * A feature represents a monetizable ability or functionality in your system.
 * Features can be assigned to products, and when those products are purchased,
 * Stripe will create an entitlement to the feature for the purchasing customer.
 *
 * @example
 * ```ts
 * new EntitlementFeature(stack, 'PremiumSupport', {
 *   name: 'Premium Support',
 *   lookupKey: 'premium-support',
 * });
 * ```
 */
export class EntitlementFeature extends Resource {
  public readonly name: string;
  public readonly lookupKey: string;
  public readonly metadata?: Record<string, string>;

  constructor(scope: Construct, id: string, props: EntitlementFeatureProps) {
    super(scope, id, props);

    this.name = props.name;
    this.lookupKey = props.lookupKey;
    this.metadata = props.metadata;

    // Register resource metadata after all properties are initialized
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return 'Stripe::EntitlementFeature';
  }

  protected synthesizeProperties(): Record<string, unknown> {
    const params: Stripe.Entitlements.FeatureCreateParams = {
      name: this.name,
      lookup_key: this.lookupKey,
    };

    if (this.metadata !== undefined) params.metadata = this.metadata;

    return params as unknown as Record<string, unknown>;
  }
}
