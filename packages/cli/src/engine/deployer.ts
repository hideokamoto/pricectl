import Stripe from 'stripe';
import { StackManifest, ResourceManifest } from '@pricectl/core';
import { findExistingProduct as stripeFindExistingProduct, findExistingPrice as stripeFindExistingPrice } from './stripe-utils';

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

export class StripeDeployer {
  private stripe: Stripe;
  private logicalToPhysicalId: Map<string, string> = new Map();

  constructor(apiKey: string, apiVersion: string = '2024-12-18.acacia') {
    this.stripe = new Stripe(apiKey, {
      apiVersion: apiVersion as any,
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
      } catch (error: any) {
        result.errors.push({
          id: resource.id,
          type: resource.type,
          error: error.message,
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
    const existing = await this.findExistingProduct(resource.id);

    if (existing) {
      // Update existing product, injecting pricectl metadata alongside properties
      const updated = await this.stripe.products.update(existing.id, {
        ...resource.properties,
        metadata: {
          ...resource.properties.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
        },
      });
      return {
        id: resource.id,
        type: resource.type,
        physicalId: updated.id,
        status: 'updated' as const,
      };
    } else {
      // Create new product
      const created = await this.stripe.products.create({
        ...resource.properties,
        metadata: {
          ...resource.properties.metadata,
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

    const existing = await this.findExistingPrice(resource.id);

    if (existing) {
      // Check if properties match
      const propsMatch = this.comparePriceProperties(existing, properties);
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
          ...properties,
          metadata: {
            ...properties.metadata,
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
        ...properties,
        metadata: {
          ...properties.metadata,
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
    try {
      const existing = await this.stripe.coupons.retrieve(resource.id);
      return {
        id: resource.id,
        type: resource.type,
        physicalId: existing.id,
        status: 'unchanged' as const,
      };
    } catch (error: any) {
      if (error.code === 'resource_missing') {
        // Create new coupon
        const created = await this.stripe.coupons.create({
          id: resource.id,
          ...resource.properties,
        });
        return {
          id: resource.id,
          type: resource.type,
          physicalId: created.id,
          status: 'created' as const,
        };
      }
      throw error;
    }
  }

  /**
   * Resolve logical IDs to physical IDs in resource properties.
   * This is critical for handling dependencies between resources.
   */
  private resolveDependencies(properties: any): any {
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

  private findExistingProduct(logicalId: string): Promise<Stripe.Product | null> {
    return stripeFindExistingProduct(this.stripe, logicalId);
  }

  private findExistingPrice(logicalId: string): Promise<Stripe.Price | null> {
    return stripeFindExistingPrice(this.stripe, logicalId);
  }

  /**
   * Compare all relevant properties of a price to determine if it needs to be recreated.
   * Prices are immutable in Stripe, so any property change requires deactivating
   * the old price and creating a new one.
   */
  private comparePriceProperties(existing: Stripe.Price, desired: any): boolean {
    // Compare basic properties
    if (existing.currency !== desired.currency) return false;
    if (existing.unit_amount !== desired.unit_amount) return false;
    if (existing.unit_amount_decimal !== desired.unit_amount_decimal) return false;
    if (existing.active !== desired.active) return false;
    if (existing.nickname !== desired.nickname) return false;

    // Compare recurring properties
    if (desired.recurring) {
      if (!existing.recurring) return false;
      if (existing.recurring.interval !== desired.recurring.interval) return false;
      if (existing.recurring.interval_count !== desired.recurring.interval_count) return false;
      if (existing.recurring.usage_type !== desired.recurring.usage_type) return false;
      if (existing.recurring.trial_period_days !== desired.recurring.trial_period_days) return false;
    } else if (existing.recurring) {
      return false;
    }

    // Compare tiers
    if (desired.tiers_mode !== existing.tiers_mode) return false;

    if (desired.tiers) {
      if (!existing.tiers || existing.tiers.length !== desired.tiers.length) return false;

      for (let i = 0; i < desired.tiers.length; i++) {
        const existingTier = existing.tiers[i];
        const desiredTier = desired.tiers[i];

        if (existingTier.up_to !== desiredTier.up_to) return false;
        if (existingTier.unit_amount !== desiredTier.unit_amount) return false;
        if (existingTier.flat_amount !== desiredTier.flat_amount) return false;
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
      } catch (error: any) {
        result.errors.push({
          id: resource.id,
          type: resource.type,
          error: error.message,
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
        try {
          await this.stripe.coupons.del(resource.id);
          return {
            id: resource.id,
            type: resource.type,
            status: 'deleted',
          };
        } catch (error: any) {
          if (error.code === 'resource_missing') {
            return null;
          }
          throw error;
        }
      }
      default:
        throw new Error(`Unknown resource type: ${resource.type}`);
    }
  }
}
