import type { ResourceManifest, StackManifest } from '@pricectl/core';
import type { StateManager } from './state';

/** Order in which resource types are removed, so that references are removed before their targets. */
const REMOVAL_ORDER = [
  'Stripe::Price',
  'Stripe::Coupon',
  'Stripe::Product',
  'Stripe::EntitlementFeature',
  'Stripe::BillingMeter',
];

/**
 * Resources recorded in the state file for this stack that the manifest no longer defines,
 * in removal order (prices before the products and meters they refer to).
 * Without a state file nothing is known about removed resources, so the result is empty.
 */
export function findOrphans(manifest: StackManifest, stateManager?: StateManager): ResourceManifest[] {
  const stack = stateManager?.getStack(manifest.stackId);
  if (!stack) return [];
  const defined = new Set(manifest.resources.map((r) => r.id));
  return Object.values(stack.resources)
    .filter((entry) => !defined.has(entry.logicalId))
    .sort((a, b) => REMOVAL_ORDER.indexOf(a.type) - REMOVAL_ORDER.indexOf(b.type))
    // Lookups during removal go through the state file, so no properties are needed
    .map((entry) => ({ id: entry.logicalId, path: entry.path, type: entry.type, properties: {} }));
}
