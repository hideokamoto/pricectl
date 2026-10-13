import Stripe from 'stripe';
import { isPricectlTag } from './metadata';

/** Metadata without the keys pricectl writes itself, or undefined when no user-defined metadata remains. */
export function stripInternalMetadata(metadata: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const userMetadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => !isPricectlTag(key)));
  return Object.keys(userMetadata).length > 0 ? userMetadata : undefined;
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
      // Exclude pricectl's own metadata from comparison
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

      // Exclude pricectl's own metadata from comparison
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
