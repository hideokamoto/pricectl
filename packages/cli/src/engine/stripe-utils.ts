import Stripe from 'stripe';
import { StateManager } from './state';

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
function stripInternalMetadata(metadata: Record<string, any> | undefined): Record<string, any> | undefined {
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
      } catch (error: any) {
        if (error?.code !== 'resource_missing') {
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
  } catch (error: any) {
    if (error.code === 'resource_missing') {
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
      } catch (error: any) {
        if (error?.code !== 'resource_missing') {
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
  } catch (error: any) {
    if (error.code === 'resource_missing') {
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
  resource: any,
  stateManager?: StateManager,
  stackId?: string,
): Promise<any> {
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
  } catch (error: any) {
    if (error.code === 'resource_missing') {
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
export function normalizeResource(resource: any, resourceType: string): any {
  const normalized: any = {};

  switch (resourceType) {
    case 'Stripe::Product': {
      if (resource.name !== undefined) normalized.name = resource.name;
      if (resource.description !== undefined) normalized.description = resource.description;
      if (resource.active !== undefined) normalized.active = resource.active;
      if (resource.images) normalized.images = resource.images;
      if (resource.url !== undefined) normalized.url = resource.url;
      if (resource.unit_label !== undefined) normalized.unit_label = resource.unit_label;
      if (resource.statement_descriptor !== undefined) {
        normalized.statement_descriptor = resource.statement_descriptor;
      }
      if (resource.tax_code !== undefined) normalized.tax_code = resource.tax_code;
      // Exclude pricectl and legacy fillet metadata from comparison
      if (resource.metadata) {
        normalized.metadata = stripInternalMetadata(resource.metadata);
      }
      break;
    }

    case 'Stripe::Price': {
      if (resource.product !== undefined) normalized.product = resource.product;
      if (resource.currency !== undefined) normalized.currency = resource.currency;
      if (resource.unit_amount !== undefined) normalized.unit_amount = resource.unit_amount;
      if (resource.unit_amount_decimal !== undefined) {
        normalized.unit_amount_decimal = resource.unit_amount_decimal;
      }
      if (resource.active !== undefined) normalized.active = resource.active;
      if (resource.nickname !== undefined) normalized.nickname = resource.nickname;
      if (resource.lookup_key !== undefined) normalized.lookup_key = resource.lookup_key;

      if (resource.recurring) {
        normalized.recurring = {};
        if (resource.recurring.interval !== undefined) {
          normalized.recurring.interval = resource.recurring.interval;
        }
        if (resource.recurring.interval_count !== undefined) {
          normalized.recurring.interval_count = resource.recurring.interval_count;
        }
        if (resource.recurring.usage_type !== undefined) {
          normalized.recurring.usage_type = resource.recurring.usage_type;
        }
        if (resource.recurring.trial_period_days !== undefined) {
          normalized.recurring.trial_period_days = resource.recurring.trial_period_days;
        }
      }

      if (resource.tiers_mode !== undefined) normalized.tiers_mode = resource.tiers_mode;
      if (resource.tiers) {
        normalized.tiers = resource.tiers.map((tier: any) => ({
          up_to: tier.up_to,
          unit_amount: tier.unit_amount,
          flat_amount: tier.flat_amount,
        }));
      }

      if (resource.transform_quantity) {
        normalized.transform_quantity = {
          divide_by: resource.transform_quantity.divide_by,
          round: resource.transform_quantity.round,
        };
      }

      // Exclude pricectl and legacy fillet metadata from comparison
      if (resource.metadata) {
        normalized.metadata = stripInternalMetadata(resource.metadata);
      }
      break;
    }

    case 'Stripe::Coupon': {
      if (resource.duration !== undefined) normalized.duration = resource.duration;
      if (resource.amount_off !== undefined) normalized.amount_off = resource.amount_off;
      if (resource.currency !== undefined) normalized.currency = resource.currency;
      if (resource.percent_off !== undefined) normalized.percent_off = resource.percent_off;
      if (resource.duration_in_months !== undefined) {
        normalized.duration_in_months = resource.duration_in_months;
      }
      if (resource.max_redemptions !== undefined) {
        normalized.max_redemptions = resource.max_redemptions;
      }
      if (resource.name !== undefined) normalized.name = resource.name;
      if (resource.redeem_by !== undefined) normalized.redeem_by = resource.redeem_by;
      if (resource.applies_to !== undefined) normalized.applies_to = resource.applies_to;
      if (resource.metadata) normalized.metadata = resource.metadata;
      break;
    }
  }

  return normalized;
}
