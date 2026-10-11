import type { ResourceManifest, StackManifest } from '@pricectl/core';
import type { ResourceState, StateManager } from './state';

/** Order in which resource types are removed, so that references are removed before their targets. */
const REMOVAL_ORDER = [
  'Stripe::Price',
  'Stripe::Coupon',
  'Stripe::Product',
  'Stripe::EntitlementFeature',
  'Stripe::BillingMeter',
];

/** Types missing from REMOVAL_ORDER are removed last, after everything that may refer to them. */
function removalRank(type: string): number {
  const index = REMOVAL_ORDER.indexOf(type);
  return index === -1 ? REMOVAL_ORDER.length : index;
}

/** Stripe IDs that the defined resources refer to directly. */
function referencedPhysicalIds(manifest: StackManifest): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string') ids.add(value);
  };
  for (const resource of manifest.resources) {
    add(resource.physicalId);
    const properties = resource.properties;
    add(properties.product);
    add((properties.recurring as { meter?: unknown } | undefined)?.meter);
    for (const feature of (properties.features as unknown[] | undefined) ?? []) add(feature);
    for (const product of (properties.applies_to as { products?: unknown[] } | undefined)?.products ?? []) add(product);
  }
  return ids;
}

/** State entries of this stack whose logical ID the manifest no longer defines. */
function undefinedEntries(manifest: StackManifest, stateManager?: StateManager): ResourceState[] {
  const stack = stateManager?.getStack(manifest.stackId);
  if (!stack) return [];
  const defined = new Set(manifest.resources.map((r) => r.id));
  return Object.values(stack.resources).filter((entry) => !defined.has(entry.logicalId));
}

/**
 * Resources recorded in the state file for this stack that the manifest no longer defines
 * and no defined resource refers to, in removal order (prices before the products and
 * meters they refer to). Without a state file nothing is known, so the result is empty.
 */
export function findOrphans(manifest: StackManifest, stateManager?: StateManager): ResourceManifest[] {
  const referenced = referencedPhysicalIds(manifest);
  return undefinedEntries(manifest, stateManager)
    .filter((entry) => !referenced.has(entry.physicalId))
    .sort((a, b) => removalRank(a.type) - removalRank(b.type))
    // Lookups during removal go through the state file, so no properties are needed
    .map((entry) => ({ id: entry.logicalId, path: entry.path, type: entry.type, properties: {} }));
}

/**
 * Resources that are no longer defined but still referred to by their Stripe ID: they are now
 * external to the stack, so they stay in Stripe and only leave the state file.
 */
export function findReleased(manifest: StackManifest, stateManager?: StateManager): ResourceState[] {
  const referenced = referencedPhysicalIds(manifest);
  return undefinedEntries(manifest, stateManager).filter((entry) => referenced.has(entry.physicalId));
}
