import type Stripe from 'stripe';
import type { ResourceManifest } from '@pricectl/core';
import type { Observations } from './read-stripe';
import type { ProductWithFeatures } from './stripe-utils';

/** The Stripe object a resource of the definition is deployed as, as plan found it; undefined when there is none. */
export type CurrentResource =
  | Stripe.Product
  | ProductWithFeatures
  | Stripe.Price
  | Stripe.Coupon
  | Stripe.Entitlements.Feature
  | Stripe.Billing.Meter;

/**
 * What `diff` compares a resource with. A product that manages its features carries the IDs of
 * the ones attached, because attachments are part of its definition.
 */
export function currentResource(resource: ResourceManifest, observations: Observations): CurrentResource | undefined {
  switch (resource.type) {
    case 'Stripe::Product': {
      const observation = observations.products.get(resource.id);
      if (!observation?.product) return undefined;
      return 'features' in resource.properties
        ? { ...observation.product, features: [...observation.attachedFeatures.keys()] }
        : observation.product;
    }
    case 'Stripe::Price':
      return observations.prices.get(resource.id)?.holder;
    case 'Stripe::Coupon':
      return observations.coupons.get(resource.id);
    case 'Stripe::EntitlementFeature':
      return observations.features.get(resource.id);
    case 'Stripe::BillingMeter':
      return (
        observations.adoptedMeters.get(resource.id) ??
        observations.activeMeters.find((meter) => meter.event_name === resource.properties.event_name)
      );
    default:
      return undefined;
  }
}
