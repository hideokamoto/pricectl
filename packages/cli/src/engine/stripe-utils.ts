import Stripe from 'stripe';
import { StateManager } from './state';

/** Check if error is a resource_missing error (works with both Stripe SDK and test mocks) */
function isResourceMissingError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: string }).code === 'resource_missing';
  }
  return false;
}

/** Whether Stripe metadata carries the given logical ID (current or legacy key). */
function hasLogicalId(metadata: Record<string, string> | null | undefined, logicalId: string): boolean {
  return metadata?.pricectl_id === logicalId || metadata?.fillet_id === logicalId;
}

/**
 * Pick the object that represents the resource now: active objects win over
 * inactive ones (e.g. prices that were replaced), then the most recently created.
 */
function pickCurrent<T extends { active: boolean; created: number }>(candidates: T[]): T | null {
  const sorted = [...candidates].sort((a, b) => Number(b.active) - Number(a.active) || b.created - a.created);
  return sorted[0] ?? null;
}

/**
 * Strip internal metadata keys (pricectl_id, pricectl_path, pricectl_properties_hash, fillet_id, fillet_path)
 * and return undefined if no user-defined metadata remains.
 */
export function stripInternalMetadata(metadata: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const {
    pricectl_id: _pid,
    pricectl_path: _ppath,
    pricectl_properties_hash: _phash,
    fillet_id: _fid,
    fillet_path: _fpath,
    ...userMetadata
  } = metadata;
  return Object.keys(userMetadata).length > 0 ? userMetadata : undefined;
}

/**
 * Find an existing Stripe Product by logical ID.
 * Uses state-based lookup first, then falls back to listing all objects.
 * Supports both the current `pricectl_id` metadata key and the legacy `fillet_id` key.
 */
export async function findExistingProduct(
  stripe: Stripe,
  logicalId: string,
  stateManager?: StateManager,
  stackId?: string,
): Promise<Stripe.Product | null> {
  // Try state-based lookup first (if available)
  if (stateManager && stackId) {
    const stateEntry = stateManager.getResource(stackId, logicalId);
    if (stateEntry?.physicalId) {
      try {
        const product = await stripe.products.retrieve(stateEntry.physicalId);
        if (product && !product.deleted) {
          return product;
        }
      } catch (error: unknown) {
        if (!isResourceMissingError(error)) {
          throw error;
        }
        // Physical ID from state is stale — fall through to listing
      }
    }
  }

  // Fall back to listing. The Search API is eventually consistent and misses
  // objects created moments ago, which would lead to duplicates.
  const matches: Stripe.Product[] = [];
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (hasLogicalId(product.metadata, logicalId)) matches.push(product);
  }
  return pickCurrent(matches);
}

/**
 * Find the Stripe Product a manifest resource manages: the product named by its
 * physicalId when one is given, otherwise the product found by its logical ID.
 */
export async function findProductForResource(
  stripe: Stripe,
  resource: { id: string; physicalId?: string },
  stateManager?: StateManager,
  stackId?: string,
): Promise<Stripe.Product | null> {
  return resource.physicalId
    ? stripe.products.retrieve(resource.physicalId)
    : findExistingProduct(stripe, resource.id, stateManager, stackId);
}

/** A product together with the IDs of the entitlement features attached to it. */
export type ProductWithFeatures = Stripe.Product & { features: string[] };

/**
 * The entitlement features attached to a product, as a map from the entitlement
 * feature ID to the ID of the product_feature that attaches it.
 */
export async function listAttachedFeatures(stripe: Stripe, productId: string): Promise<Map<string, string>> {
  const attached = new Map<string, string>();
  for await (const productFeature of stripe.products.listFeatures(productId, { limit: 100 })) {
    attached.set(productFeature.entitlement_feature.id, productFeature.id);
  }
  return attached;
}

async function withAttachedFeatures(stripe: Stripe, product: Stripe.Product | null): Promise<ProductWithFeatures | null> {
  if (!product) return null;
  const attached = await listAttachedFeatures(stripe, product.id);
  return { ...product, features: [...attached.keys()] };
}

/**
 * Find an existing Stripe Price by logical ID.
 * Uses state-based lookup first, then falls back to listing all objects.
 * Supports both the current `pricectl_id` metadata key and the legacy `fillet_id` key.
 */
export async function findExistingPrice(
  stripe: Stripe,
  logicalId: string,
  stateManager?: StateManager,
  stackId?: string,
): Promise<Stripe.Price | null> {
  // Try state-based lookup first (if available)
  if (stateManager && stackId) {
    const stateEntry = stateManager.getResource(stackId, logicalId);
    if (stateEntry?.physicalId) {
      try {
        const price = await stripe.prices.retrieve(stateEntry.physicalId, { expand: ['tiers'] });
        if (price) {
          return price;
        }
      } catch (error: unknown) {
        if (!isResourceMissingError(error)) {
          throw error;
        }
        // Physical ID from state is stale — fall through to listing
      }
    }
  }

  // Fall back to listing (see findExistingProduct for why not the Search API)
  const matches: Stripe.Price[] = [];
  for await (const price of stripe.prices.list({ limit: 100, expand: ['data.tiers'] })) {
    if (hasLogicalId(price.metadata, logicalId)) matches.push(price);
  }
  return pickCurrent(matches);
}

/**
 * Fetch the current state of any resource from Stripe.
 * Uses state-based lookup when available, then falls back to the Search API for Products and Prices,
 * and direct retrieval for Coupons.
 */
export async function fetchCurrentResource(
  stripe: Stripe,
  resource: { type: string; id: string; physicalId?: string; properties?: Record<string, unknown> },
  stateManager?: StateManager,
  stackId?: string,
): Promise<Stripe.Product | Stripe.Price | Stripe.Coupon | Stripe.Entitlements.Feature | Stripe.Billing.Meter | null> {
  try {
    switch (resource.type) {
      case 'Stripe::Product': {
        const product = await findProductForResource(stripe, resource, stateManager, stackId);
        // Attachments are only compared for products that manage their features
        return resource.properties && 'features' in resource.properties
          ? await withAttachedFeatures(stripe, product)
          : product;
      }
      case 'Stripe::Price':
        return findExistingPrice(stripe, resource.id, stateManager, stackId);
      case 'Stripe::Coupon':
        return await stripe.coupons.retrieve(resource.id);
      case 'Stripe::EntitlementFeature': {
        // Same lookup as deploy: a physicalId in the construct props names the feature directly
        if (resource.physicalId) {
          return await stripe.entitlements.features.retrieve(resource.physicalId);
        }
        // Try state-based lookup first
        if (stateManager && stackId) {
          const stateEntry = stateManager.getResource(stackId, resource.id);
          if (stateEntry?.physicalId) {
            try {
              return await stripe.entitlements.features.retrieve(stateEntry.physicalId);
            } catch (error: unknown) {
              if (!isResourceMissingError(error)) {
                throw error;
              }
            }
          }
        }
        // Fall back to paginated search by pricectl_id metadata
        for await (const feature of stripe.entitlements.features.list({ limit: 100 })) {
          if (feature.metadata?.pricectl_id === resource.id) {
            return feature;
          }
        }
        return null;
      }
      case 'Stripe::BillingMeter': {
        if (resource.physicalId) {
          return await stripe.billing.meters.retrieve(resource.physicalId);
        }
        // Try state-based lookup (Billing Meters don't support metadata,
        // so state is the only reliable way to find them by logical ID)
        if (stateManager && stackId) {
          const stateEntry = stateManager.getResource(stackId, resource.id);
          if (stateEntry?.physicalId) {
            try {
              return await stripe.billing.meters.retrieve(stateEntry.physicalId);
            } catch (error: unknown) {
              if (!isResourceMissingError(error)) {
                throw error;
              }
            }
          }
        }
        return null;
      }
      default:
        throw new Error(`Unsupported resource type: ${resource.type}`);
    }
  } catch (error: unknown) {
    if (isResourceMissingError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * stripe-node (v21+) returns decimal_string fields as Stripe.Decimal objects;
 * normalized resources carry them as plain strings, like the construct properties.
 */
function decimalString(value: Stripe.Decimal | string | null | undefined): string | null | undefined {
  return value === null || value === undefined ? value : String(value);
}

/**
 * Normalize a Stripe resource to match the format of our construct properties.
 * Strips internal metadata keys and retains only user-configurable properties
 * to enable accurate comparison between desired and current state.
 */
export function normalizeResource(resource: Stripe.Product | Stripe.Price | Stripe.Coupon | Stripe.Entitlements.Feature | Stripe.Billing.Meter, resourceType: string): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  switch (resourceType) {
    case 'Stripe::Product': {
      const r = resource as Stripe.Product;
      if (r.name != null) normalized.name = r.name;
      if (r.description != null) normalized.description = r.description;
      if (r.active != null) normalized.active = r.active;
      if (r.images != null) normalized.images = r.images;
      if (r.url != null) normalized.url = r.url;
      if (r.unit_label != null) normalized.unit_label = r.unit_label;
      if (r.statement_descriptor != null) {
        normalized.statement_descriptor = r.statement_descriptor;
      }
      if (r.tax_code != null) normalized.tax_code = r.tax_code;
      const attached = (resource as Partial<ProductWithFeatures>).features;
      if (attached) normalized.features = [...attached].sort();
      // Exclude pricectl and legacy fillet metadata from comparison
      const productMetadata = stripInternalMetadata(r.metadata);
      if (productMetadata) {
        normalized.metadata = productMetadata;
      }
      break;
    }

    case 'Stripe::Price': {
      const r = resource as Stripe.Price;
      if (r.product !== undefined) normalized.product = r.product;
      if (r.currency !== undefined) normalized.currency = r.currency;
      if (r.unit_amount !== undefined) normalized.unit_amount = r.unit_amount;
      if (r.unit_amount_decimal !== undefined) {
        normalized.unit_amount_decimal = decimalString(r.unit_amount_decimal);
      }
      if (r.active !== undefined) normalized.active = r.active;
      if (r.nickname !== undefined) normalized.nickname = r.nickname;
      if (r.lookup_key !== undefined) normalized.lookup_key = r.lookup_key;
      if (r.tax_behavior !== undefined) normalized.tax_behavior = r.tax_behavior;
      if (r.billing_scheme !== undefined) normalized.billing_scheme = r.billing_scheme;

      if (r.recurring) {
        const rec: Record<string, unknown> = {};
        if (r.recurring.interval !== undefined) {
          rec.interval = r.recurring.interval;
        }
        if (r.recurring.interval_count !== undefined) {
          rec.interval_count = r.recurring.interval_count;
        }
        if (r.recurring.usage_type !== undefined) {
          rec.usage_type = r.recurring.usage_type;
        }
        if (r.recurring.trial_period_days !== undefined) {
          rec.trial_period_days = r.recurring.trial_period_days;
        }
        const meter = (r.recurring as { meter?: string | null }).meter;
        if (meter !== undefined) rec.meter = meter;
        normalized.recurring = rec;
      }

      if (r.tiers_mode !== undefined) normalized.tiers_mode = r.tiers_mode;
      if (r.tiers) {
        normalized.tiers = r.tiers.map((tier) => ({
          up_to: tier.up_to,
          unit_amount: tier.unit_amount,
          unit_amount_decimal: decimalString(tier.unit_amount_decimal),
          flat_amount: tier.flat_amount,
          flat_amount_decimal: decimalString(tier.flat_amount_decimal),
        }));
      }

      if (r.transform_quantity) {
        normalized.transform_quantity = {
          divide_by: r.transform_quantity.divide_by,
          round: r.transform_quantity.round,
        };
      }

      // Exclude pricectl and legacy fillet metadata from comparison
      const priceMetadata = stripInternalMetadata(r.metadata);
      if (priceMetadata) {
        normalized.metadata = priceMetadata;
      }
      break;
    }

    case 'Stripe::Coupon': {
      const r = resource as Stripe.Coupon;
      if (r.duration !== undefined) normalized.duration = r.duration;
      if (r.amount_off !== undefined) normalized.amount_off = r.amount_off;
      if (r.currency !== undefined) normalized.currency = r.currency;
      if (r.percent_off !== undefined) normalized.percent_off = r.percent_off;
      if (r.duration_in_months !== undefined) {
        normalized.duration_in_months = r.duration_in_months;
      }
      if (r.max_redemptions !== undefined) {
        normalized.max_redemptions = r.max_redemptions;
      }
      if (r.name !== undefined) normalized.name = r.name;
      if (r.redeem_by !== undefined) normalized.redeem_by = r.redeem_by;
      if (r.applies_to !== undefined) normalized.applies_to = r.applies_to;
      const couponMetadata = stripInternalMetadata(r.metadata);
      if (couponMetadata) {
        normalized.metadata = couponMetadata;
      }
      break;
    }

    case 'Stripe::EntitlementFeature': {
      const r = resource as Stripe.Entitlements.Feature;
      if (r.name !== undefined) normalized.name = r.name;
      if (r.lookup_key !== undefined) normalized.lookup_key = r.lookup_key;
      const featureMetadata = stripInternalMetadata(r.metadata);
      if (featureMetadata) {
        normalized.metadata = featureMetadata;
      }
      break;
    }

    case 'Stripe::BillingMeter': {
      const r = resource as Stripe.Billing.Meter;
      if (r.display_name !== undefined) normalized.display_name = r.display_name;
      if (r.event_name !== undefined) normalized.event_name = r.event_name;
      if (r.default_aggregation !== undefined) {
        normalized.default_aggregation = {
          formula: r.default_aggregation.formula,
        };
      }
      if (r.customer_mapping !== undefined) {
        normalized.customer_mapping = {
          event_payload_key: r.customer_mapping.event_payload_key,
          type: r.customer_mapping.type,
        };
      }
      if (r.event_time_window !== undefined) {
        normalized.event_time_window = r.event_time_window;
      }
      if (r.value_settings !== undefined) {
        normalized.value_settings = {
          event_payload_key: r.value_settings.event_payload_key,
        };
      }
      break;
    }
  }

  return normalized;
}
