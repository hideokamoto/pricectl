import Stripe from 'stripe';
import { StateManager } from './state';

/** Check if error is a resource_missing error (works with both Stripe SDK and test mocks) */
function isResourceMissingError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: string }).code === 'resource_missing';
  }
  return false;
}

/**
 * Escape a logical ID for use in a Stripe Search API query.
 * Prevents search query injection by escaping backslashes and double quotes.
 */
export function escapeSearchQuery(id: string): string {
  return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Strip internal metadata keys (pricectl_id, pricectl_path, fillet_id, fillet_path)
 * and return undefined if no user-defined metadata remains.
 */
function stripInternalMetadata(metadata: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const { pricectl_id: _pid, pricectl_path: _ppath, fillet_id: _fid, fillet_path: _fpath, ...userMetadata } = metadata;
  return Object.keys(userMetadata).length > 0 ? userMetadata : undefined;
}

/**
 * Find an existing Stripe Product by logical ID.
 * Uses state-based lookup first for speed, then falls back to the Search API.
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
        // Physical ID from state is stale — fall through to search
      }
    }
  }

  // Fall back to Search API
  try {
    const escapedId = escapeSearchQuery(logicalId);
    const result = await stripe.products.search({
      query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
      limit: 1,
    });
    return result.data.length > 0 ? result.data[0] : null;
  } catch (error: unknown) {
    if (isResourceMissingError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Find an existing Stripe Price by logical ID.
 * Uses state-based lookup first for speed, then falls back to the Search API.
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
        const price = await stripe.prices.retrieve(stateEntry.physicalId);
        if (price) {
          return price;
        }
      } catch (error: unknown) {
        if (!isResourceMissingError(error)) {
          throw error;
        }
        // Physical ID from state is stale — fall through to search
      }
    }
  }

  // Fall back to Search API
  try {
    const escapedId = escapeSearchQuery(logicalId);
    const result = await stripe.prices.search({
      query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
      limit: 1,
    });
    return result.data.length > 0 ? result.data[0] : null;
  } catch (error: unknown) {
    if (isResourceMissingError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch the current state of any resource from Stripe.
 * Uses state-based lookup when available, then falls back to the Search API for Products and Prices,
 * and direct retrieval for Coupons.
 */
export async function fetchCurrentResource(
  stripe: Stripe,
  resource: { type: string; id: string },
  stateManager?: StateManager,
  stackId?: string,
): Promise<Stripe.Product | Stripe.Price | Stripe.Coupon | null> {
  try {
    switch (resource.type) {
      case 'Stripe::Product':
        return findExistingProduct(stripe, resource.id, stateManager, stackId);
      case 'Stripe::Price':
        return findExistingPrice(stripe, resource.id, stateManager, stackId);
      case 'Stripe::Coupon':
        return await stripe.coupons.retrieve(resource.id);
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
 * Normalize a Stripe resource to match the format of our construct properties.
 * Strips internal metadata keys and retains only user-configurable properties
 * to enable accurate comparison between desired and current state.
 */
export function normalizeResource(resource: Stripe.Product | Stripe.Price | Stripe.Coupon, resourceType: string): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  switch (resourceType) {
    case 'Stripe::Product': {
      const r = resource as Stripe.Product;
      if (r.name !== undefined) normalized.name = r.name;
      if (r.description !== undefined) normalized.description = r.description;
      if (r.active !== undefined) normalized.active = r.active;
      if (r.images) normalized.images = r.images;
      if (r.url !== undefined) normalized.url = r.url;
      if (r.unit_label !== undefined) normalized.unit_label = r.unit_label;
      if (r.statement_descriptor !== undefined) {
        normalized.statement_descriptor = r.statement_descriptor;
      }
      if (r.tax_code !== undefined) normalized.tax_code = r.tax_code;
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
        normalized.unit_amount_decimal = r.unit_amount_decimal;
      }
      if (r.active !== undefined) normalized.active = r.active;
      if (r.nickname !== undefined) normalized.nickname = r.nickname;
      if (r.lookup_key !== undefined) normalized.lookup_key = r.lookup_key;

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
        normalized.recurring = rec;
      }

      if (r.tiers_mode !== undefined) normalized.tiers_mode = r.tiers_mode;
      if (r.tiers) {
        normalized.tiers = r.tiers.map((tier) => ({
          up_to: tier.up_to,
          unit_amount: tier.unit_amount,
          flat_amount: tier.flat_amount,
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
  }

  return normalized;
}
