import Stripe from 'stripe';
import { StackManifest, ResourceManifest } from '@pricectl/core';

export interface DeployResult {
  stackId: string;
  deployed: Array<{
    id: string;
    type: string;
    physicalId: string;
    status: 'created' | 'updated' | 'unchanged';
  }>;
  errors: Array<{
    id: string;
    type: string;
    error: string;
  }>;
}

export interface DestroyResult {
  stackId: string;
  destroyed: Array<{
    id: string;
    type: string;
    status: 'deleted' | 'deactivated';
  }>;
  errors: Array<{
    id: string;
    type: string;
    error: string;
  }>;
}

/** Check if error is a resource_missing error (works with both Stripe SDK and test mocks) */
function isResourceNotFoundError(error: unknown): boolean {
  // Check for plain objects with a code property (works with both Stripe errors and test mocks)
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code?: string }).code === 'resource_missing';
  }
  return false;
}

/** Validate and cast object to Stripe.ProductCreateParams */
function validateProductCreateParams(properties: unknown): Stripe.ProductCreateParams {
  if (typeof properties !== 'object' || properties === null) {
    throw new Error('Invalid product properties: expected an object');
  }
  // Trust that the properties object has the correct structure at runtime
  // (validated by the manifests from the user's code)
  return properties as Stripe.ProductCreateParams;
}

export class StripeDeployer {
  private stripe: Stripe;
  private logicalToPhysicalId: Map<string, string> = new Map();

  constructor(apiKey: string, apiVersion?: string) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: (apiVersion ?? '2024-12-18.acacia') as Stripe.LatestApiVersion,
    });
  }

  async deploy(manifest: StackManifest): Promise<DeployResult> {
    const result: DeployResult = {
      stackId: manifest.stackId,
      deployed: [],
      errors: [],
    };

    // Reset the ID mapping for this deployment
    this.logicalToPhysicalId.clear();

    for (const resource of manifest.resources) {
      try {
        const deployed = await this.deployResource(resource);
        result.deployed.push(deployed);

        // Store the mapping from logical ID to physical ID
        this.logicalToPhysicalId.set(resource.id, deployed.physicalId);
      } catch (error: unknown) {
        result.errors.push({
          id: resource.id,
          type: resource.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async deployResource(resource: ResourceManifest) {
    switch (resource.type) {
      case 'Stripe::Product':
        return this.deployProduct(resource);
      case 'Stripe::Price':
        return this.deployPrice(resource);
      case 'Stripe::Coupon':
        return this.deployCoupon(resource);
      default:
        throw new Error(`Unknown resource type: ${resource.type}`);
    }
  }

  private async deployProduct(resource: ResourceManifest) {
    const props = validateProductCreateParams(resource.properties);
    const existing = await this.findExistingProduct(resource.id);

    if (existing) {
      // Update existing product, injecting pricectl metadata alongside properties
      const updated = await this.stripe.products.update(existing.id, {
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
        },
      } as Stripe.ProductUpdateParams);
      return {
        id: resource.id,
        type: resource.type,
        physicalId: updated.id,
        status: 'updated' as const,
      };
    } else {
      // Create new product
      const created = await this.stripe.products.create({
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
        },
      });
      return {
        id: resource.id,
        type: resource.type,
        physicalId: created.id,
        status: 'created' as const,
      };
    }
  }

  private async deployPrice(resource: ResourceManifest) {
    // Resolve the product dependency
    const properties = this.resolveDependencies(resource.properties);
    const props = properties as unknown as Stripe.PriceCreateParams;

    const existing = await this.findExistingPrice(resource.id);

    if (existing) {
      // Check if properties match
      const propsMatch = this.comparePriceProperties(existing, props);
      if (propsMatch) {
        return {
          id: resource.id,
          type: resource.type,
          physicalId: existing.id,
          status: 'unchanged' as const,
        };
      } else {
        // Deactivate old price and create new one
        await this.stripe.prices.update(existing.id, { active: false });
        const created = await this.stripe.prices.create({
          ...props,
          metadata: {
            ...props.metadata,
            pricectl_id: resource.id,
            pricectl_path: resource.path,
          },
        });
        return {
          id: resource.id,
          type: resource.type,
          physicalId: created.id,
          status: 'created' as const,
        };
      }
    } else {
      const created = await this.stripe.prices.create({
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
        },
      });
      return {
        id: resource.id,
        type: resource.type,
        physicalId: created.id,
        status: 'created' as const,
      };
    }
  }

  private async deployCoupon(resource: ResourceManifest) {
    const existing = await this.findExistingCoupon(resource.id);

    if (existing) {
      return {
        id: resource.id,
        type: resource.type,
        physicalId: existing.id,
        status: 'unchanged' as const,
      };
    } else {
      // Create new coupon
      const props = resource.properties as unknown as Stripe.CouponCreateParams;
      const created = await this.stripe.coupons.create({
        id: resource.id,
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
        },
      });
      return {
        id: resource.id,
        type: resource.type,
        physicalId: created.id,
        status: 'created' as const,
      };
    }
  }

  /**
   * Resolve logical IDs to physical IDs in resource properties.
   * This is critical for handling dependencies between resources.
   */
  private resolveDependencies(properties: Record<string, unknown>): Record<string, unknown> {
    const resolved = { ...properties };

    // Resolve product reference in Price
    if (resolved.product && typeof resolved.product === 'string') {
      const physicalId = this.logicalToPhysicalId.get(resolved.product);
      if (physicalId) {
        resolved.product = physicalId;
      }
    }

    return resolved;
  }

  private async findExistingProduct(logicalId: string): Promise<Stripe.Product | null> {
    // Escape backslashes first, then escape double quotes in logicalId to prevent search query injection
    const escapedId = logicalId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Use search API with OR query to support both old and new metadata keys
    const result = await this.stripe.products.search({
      query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
      limit: 1,
    });

    if (result.data.length > 0) {
      return result.data[0];
    }

    return null;
  }

  private async findExistingPrice(logicalId: string): Promise<Stripe.Price | null> {
    // Escape backslashes first, then escape double quotes in logicalId to prevent search query injection
    const escapedId = logicalId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Use search API with OR query to support both old and new metadata keys
    const result = await this.stripe.prices.search({
      query: `metadata["pricectl_id"]:"${escapedId}" OR metadata["fillet_id"]:"${escapedId}"`,
      limit: 1,
    });

    if (result.data.length > 0) {
      return result.data[0];
    }

    return null;
  }

  private async findExistingCoupon(logicalId: string): Promise<Stripe.Coupon | null> {
    // Coupons don't support search API, so we retrieve by logical ID directly.
    // If metadata support is needed in the future, coupons would need to be queried via list() with pagination.
    try {
      return await this.stripe.coupons.retrieve(logicalId);
    } catch (error: unknown) {
      if (isResourceNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Compare all relevant properties of a price to determine if it needs to be recreated.
   * Prices are immutable in Stripe, so any property change requires deactivating
   * the old price and creating a new one.
   */
  private comparePriceProperties(existing: Stripe.Price, desired: Stripe.PriceCreateParams): boolean {
    // Compare basic properties
    if (existing.currency !== desired.currency) return false;
    if (existing.unit_amount !== desired.unit_amount) return false;
    if (existing.unit_amount_decimal !== desired.unit_amount_decimal) return false;
    if (existing.active !== desired.active) return false;
    if (existing.nickname !== desired.nickname) return false;
    if ((existing.tax_behavior ?? undefined) !== (desired.tax_behavior ?? undefined)) return false;

    // Compare recurring properties
    if (desired.recurring) {
      if (!existing.recurring) return false;
      if (existing.recurring.interval !== desired.recurring.interval) return false;
      if (existing.recurring.interval_count !== desired.recurring.interval_count) return false;
      if (existing.recurring.usage_type !== desired.recurring.usage_type) return false;
      // Treat null (API response) and undefined (request) as equivalent for trial_period_days
      const existingTrialDays = existing.recurring.trial_period_days ?? undefined;
      const desiredTrialDays = desired.recurring.trial_period_days ?? undefined;
      if (existingTrialDays !== desiredTrialDays) return false;
    } else if (existing.recurring) {
      return false;
    }

    // Compare tiers and billing scheme
    if ((existing.billing_scheme ?? undefined) !== (desired.billing_scheme ?? undefined)) return false;
    if (desired.tiers_mode !== existing.tiers_mode) return false;

    if (desired.tiers) {
      if (!existing.tiers || existing.tiers.length !== desired.tiers.length) return false;

      for (let i = 0; i < desired.tiers.length; i++) {
        const existingTier = existing.tiers[i];
        const desiredTier = desired.tiers[i];

        if (existingTier.up_to !== desiredTier.up_to) return false;
        if (existingTier.unit_amount !== desiredTier.unit_amount) return false;
        if (existingTier.unit_amount_decimal !== desiredTier.unit_amount_decimal) return false;
        if (existingTier.flat_amount !== desiredTier.flat_amount) return false;
        if (existingTier.flat_amount_decimal !== desiredTier.flat_amount_decimal) return false;
      }
    } else if (existing.tiers) {
      return false;
    }

    // Compare transform_quantity
    if (desired.transform_quantity) {
      if (!existing.transform_quantity) return false;
      if (existing.transform_quantity.divide_by !== desired.transform_quantity.divide_by) return false;
      if (existing.transform_quantity.round !== desired.transform_quantity.round) return false;
    } else if (existing.transform_quantity) {
      return false;
    }

    // Compare lookup_key
    if (existing.lookup_key !== desired.lookup_key) return false;

    return true;
  }

  async destroy(manifest: StackManifest): Promise<DestroyResult> {
    const result: DestroyResult = {
      stackId: manifest.stackId,
      destroyed: [],
      errors: [],
    };

    // Delete resources in reverse order to handle dependencies
    const resources = [...manifest.resources].reverse();

    for (const resource of resources) {
      try {
        const destroyed = await this.destroyResource(resource);
        if (destroyed) {
          result.destroyed.push(destroyed);
        }
      } catch (error: unknown) {
        result.errors.push({
          id: resource.id,
          type: resource.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async destroyResource(resource: ResourceManifest): Promise<{
    id: string;
    type: string;
    status: 'deleted' | 'deactivated';
  } | null> {
    switch (resource.type) {
      case 'Stripe::Product': {
        const existing = await this.findExistingProduct(resource.id);
        if (existing) {
          await this.stripe.products.del(existing.id);
          return {
            id: resource.id,
            type: resource.type,
            status: 'deleted',
          };
        }
        return null;
      }
      case 'Stripe::Price': {
        const existing = await this.findExistingPrice(resource.id);
        if (existing) {
          // Prices cannot be deleted, only deactivated
          await this.stripe.prices.update(existing.id, { active: false });
          return {
            id: resource.id,
            type: resource.type,
            status: 'deactivated',
          };
        }
        return null;
      }
      case 'Stripe::Coupon': {
        const existing = await this.findExistingCoupon(resource.id);
        if (existing) {
          await this.stripe.coupons.del(existing.id);
          return {
            id: resource.id,
            type: resource.type,
            status: 'deleted',
          };
        }
        return null;
      }
      default:
        throw new Error(`Unknown resource type: ${resource.type}`);
    }
  }
}
