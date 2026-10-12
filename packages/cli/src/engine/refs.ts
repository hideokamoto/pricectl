import type { ResourceManifest, StackManifest } from '@pricectl/core';

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
