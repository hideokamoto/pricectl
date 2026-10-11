import { normalizeResource } from './stripe-utils';
import type { StateManager } from './state';

type StripeResource = Parameters<typeof normalizeResource>[0];
type Plain = Record<string, unknown>;

/** Comparison of one resource's desired properties with its current state in Stripe. */
export interface ResourceDiff {
  changed: boolean;
  /** Current state, as pretty-printed JSON for display. */
  current: string;
  /** Desired state, as pretty-printed JSON for display. */
  desired: string;
}

/**
 * Values Stripe fills in when a field is not set. Leaving such a field unset in
 * the construct and getting the default back from Stripe is not a change.
 */
const STRIPE_DEFAULTS: Record<string, Plain> = {
  'Stripe::Product': { images: [] },
  'Stripe::Price': { billing_scheme: 'per_unit', tax_behavior: 'unspecified' },
  'Stripe::BillingMeter': {
    customer_mapping: { event_payload_key: 'stripe_customer_id', type: 'by_id' },
    value_settings: { event_payload_key: 'value' },
  },
};

const RECURRING_DEFAULTS: Plain = { interval_count: 1, usage_type: 'licensed' };

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Recursively drop null/undefined values and empty objects, and sort object keys. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== 'object') return value;
  const result: Plain = {};
  for (const key of Object.keys(value).sort()) {
    const item = compact((value as Plain)[key]);
    if (item === null || item === undefined) continue;
    if (typeof item === 'object' && !Array.isArray(item) && Object.keys(item as Plain).length === 0) continue;
    result[key] = item;
  }
  return result;
}

function withoutDefaults(properties: Plain, defaults: Plain): Plain {
  const result: Plain = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key in defaults && isSame(compact(value), compact(defaults[key]))) continue;
    result[key] = value;
  }
  return result;
}

/** A decimal amount that only repeats the integer amount carries no information. */
function withoutRedundantDecimal(amounts: Plain, amountKey: string): Plain {
  const decimalKey = `${amountKey}_decimal`;
  const { [decimalKey]: decimal, ...rest } = amounts;
  const amount = amounts[amountKey];
  const redundant = decimal === undefined || decimal === null || (amount !== null && amount !== undefined && String(amount) === decimal);
  return redundant ? rest : amounts;
}

function canonicalProduct(properties: Plain): Plain {
  // Attachment order carries no meaning
  return Array.isArray(properties.features)
    ? { ...properties, features: [...(properties.features as string[])].sort() }
    : properties;
}

function canonicalPrice(properties: Plain): Plain {
  let price = withoutRedundantDecimal(properties, 'unit_amount');
  if (price.recurring && typeof price.recurring === 'object') {
    price = { ...price, recurring: withoutDefaults(price.recurring as Plain, RECURRING_DEFAULTS) };
  }
  if (Array.isArray(price.tiers)) {
    price = {
      ...price,
      tiers: (price.tiers as Plain[]).map((tier) => {
        // Stripe returns the open-ended last tier as up_to: null
        const normalized = { ...tier, up_to: tier.up_to === null ? 'inf' : tier.up_to };
        return withoutRedundantDecimal(withoutRedundantDecimal(normalized, 'unit_amount'), 'flat_amount');
      }),
    };
  }
  return price;
}

/** Map desired properties or a normalized Stripe resource into one comparable shape. */
function canonical(type: string, properties: Plain): unknown {
  let result = withoutDefaults(properties, STRIPE_DEFAULTS[type] ?? {});
  if (type === 'Stripe::Price') result = canonicalPrice(result);
  if (type === 'Stripe::Product') result = canonicalProduct(result);
  return compact(result);
}

/** Compare desired construct properties with the resource currently in Stripe. */
export function diffResource(
  type: string,
  desiredProperties: Record<string, unknown>,
  current: StripeResource,
): ResourceDiff {
  const currentProperties = normalizeResource(current, type);
  // A product that does not set features leaves its attachments unmanaged (as deploy does)
  if (type === 'Stripe::Product' && !('features' in desiredProperties)) {
    delete currentProperties.features;
  }
  const desired = JSON.stringify(canonical(type, desiredProperties), null, 2);
  const existing = JSON.stringify(canonical(type, currentProperties), null, 2);
  return { changed: desired !== existing, current: existing, desired };
}

/**
 * Replace logical IDs that reference other resources with their physical IDs from
 * the state file, so desired properties can be compared with what Stripe returns.
 */
export function resolveReferencesFromState(
  resource: { type: string; properties: Record<string, unknown> },
  stackId: string,
  stateManager?: StateManager,
): Record<string, unknown> {
  const desired = { ...resource.properties };

  if (!stateManager) {
    return desired;
  }

  const physicalIdOf = (logicalId: unknown, type: string): string | undefined => {
    if (typeof logicalId !== 'string') return undefined;
    const entry = stateManager.getResource(stackId, logicalId);
    return entry?.type === type ? entry.physicalId : undefined;
  };

  if (resource.type === 'Stripe::Product') {
    if (Array.isArray(desired.features)) {
      desired.features = desired.features.map((id) => physicalIdOf(id, 'Stripe::EntitlementFeature') ?? id);
    }
    return desired;
  }

  if (resource.type !== 'Stripe::Price') {
    return desired;
  }

  const productId = physicalIdOf(desired.product, 'Stripe::Product');
  if (productId) desired.product = productId;

  const recurring = desired.recurring as Record<string, unknown> | undefined;
  const meterId = physicalIdOf(recurring?.meter, 'Stripe::BillingMeter');
  if (recurring && meterId) desired.recurring = { ...recurring, meter: meterId };

  return desired;
}
