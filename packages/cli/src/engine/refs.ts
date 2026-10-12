import type { ResourceManifest, StackManifest } from '@pricectl/core';
import type { Observations } from './read-stripe';

/** The resources of a manifest by logical ID. */
export function indexResources(manifest: StackManifest): Map<string, ResourceManifest> {
  return new Map(manifest.resources.map((resource) => [resource.id, resource]));
}

/** The Stripe ID of a product: the one it is adopted by, otherwise the ID pricectl derives. */
export function productIdOf(resource: ResourceManifest): string {
  return resource.physicalId ?? resource.key;
}

/** The lookup key of a price: the one its definition sets, otherwise the derived key. */
export function priceLookupKeyOf(resource: ResourceManifest): string {
  const explicit = resource.properties.lookup_key;
  return typeof explicit === 'string' ? explicit : resource.key;
}

/**
 * A product reference in a price: a product of the definition becomes its Stripe ID, anything
 * else is already a Stripe ID.
 */
export function resolveProductRef(resources: Map<string, ResourceManifest>, ref: string): string {
  const target = resources.get(ref);
  return target?.type === 'Stripe::Product' ? productIdOf(target) : ref;
}

/**
 * A feature reference in a product: a feature of the definition becomes its Stripe ID when it
 * exists, otherwise it stays a logical ID until the plan creates the feature.
 */
export function resolveFeatureRef(ref: string, resources: Map<string, ResourceManifest>, observations: Observations): string {
  const target = resources.get(ref);
  if (target?.type !== 'Stripe::EntitlementFeature') return ref;
  return observations.features.get(target.id)?.id ?? target.physicalId ?? ref;
}

/**
 * A meter reference in a metered price: a meter of the definition becomes its Stripe ID when the
 * meter exists, otherwise it stays a logical ID until the plan creates the meter.
 */
export function resolveMeterRef(ref: string, resources: Map<string, ResourceManifest>, observations: Observations): string {
  const target = resources.get(ref);
  if (target?.type !== 'Stripe::BillingMeter') return ref;
  const existing =
    observations.adoptedMeters.get(target.id) ??
    observations.activeMeters.find((meter) => meter.event_name === target.properties.event_name);
  return existing?.id ?? target.physicalId ?? ref;
}
