import Stripe from 'stripe';
import { StackManifest, ResourceManifest, DEFAULT_STRIPE_API_VERSION } from '@pricectl/core';
import {
  findExistingProduct as stripeFindExistingProduct,
  findExistingPrice as stripeFindExistingPrice,
  findProductForResource,
  listAttachedFeatures,
  stripInternalMetadata,
} from './stripe-utils';
import { StateManager } from './state';
import { findOrphans } from './orphans';
import { isPriceEquivalent } from './price-comparison';

export interface DeployResult {
  stackId: string;
  deployed: Array<{
    id: string;
    type: string;
    physicalId: string;
    status: 'created' | 'updated' | 'unchanged';
  }>;
  /** Whether removing resources that are no longer defined was skipped because of errors */
  removalSkipped: boolean;
  /** Resources recorded in the state file that are no longer defined, removed during deploy */
  removed: Array<{
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

/** Coupon fields that Stripe does not allow to change after creation. */
const IMMUTABLE_COUPON_FIELDS = [
  'duration',
  'amount_off',
  'currency',
  'percent_off',
  'duration_in_months',
  'max_redemptions',
  'redeem_by',
] as const;

/** Compare a coupon field from Stripe (null when unset) with the desired value (undefined when unset). */
function isSameCouponValue(existing: unknown, desired: unknown): boolean {
  return (existing ?? null) === (desired ?? null);
}

/**
 * Metadata update that turns `current` into `desired`: changed keys get their new value and
 * removed keys are unset with an empty string. Returns null when nothing changes.
 */
function metadataChanges(
  current: Record<string, string>,
  desired: Record<string | number, string | number | null>,
): Record<string, string> | null {
  const update: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    const next = value === null ? '' : String(value);
    if (current[key] !== next) update[key] = next;
  }
  for (const key of Object.keys(current)) {
    if (!(key in desired)) update[key] = '';
  }
  return Object.keys(update).length > 0 ? update : null;
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
  private stateManager: StateManager | undefined;

  constructor(apiKey: string, apiVersion?: string, stateManager?: StateManager) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: (apiVersion ?? DEFAULT_STRIPE_API_VERSION) as Stripe.LatestApiVersion,
    });
    this.stateManager = stateManager;
  }

  async deploy(manifest: StackManifest): Promise<DeployResult> {
    const result: DeployResult = {
      stackId: manifest.stackId,
      deployed: [],
      removalSkipped: false,
      removed: [],
      errors: [],
    };

    // Reset the ID mapping for this deployment
    this.logicalToPhysicalId.clear();

    for (const resource of manifest.resources) {
      try {
        const deployed = await this.deployResource(resource, manifest.stackId);
        result.deployed.push(deployed);

        // Store the mapping from logical ID to physical ID
        this.logicalToPhysicalId.set(resource.id, deployed.physicalId);

        // Update state with deployed resource
        if (this.stateManager) {
          this.stateManager.setResource(manifest.stackId, {
            logicalId: resource.id,
            physicalId: deployed.physicalId,
            type: resource.type,
            path: resource.path,
            lastDeployedAt: new Date().toISOString(),
            propertiesHash: StateManager.computePropertiesHash(resource.properties),
          });
        }
      } catch (error: unknown) {
        result.errors.push({
          id: resource.id,
          type: resource.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // A failed resource may be the replacement of one that is no longer defined, so nothing
    // is removed unless every defined resource deployed successfully
    if (result.errors.length > 0) {
      result.removalSkipped = findOrphans(manifest, this.stateManager).length > 0;
    } else {
      await this.removeOrphans(manifest, result);
    }

    return result;
  }

  /** Remove resources that were deleted from the definition since the last deploy. */
  private async removeOrphans(manifest: StackManifest, result: DeployResult): Promise<void> {
    for (const orphan of findOrphans(manifest, this.stateManager)) {
      try {
        const removed = await this.destroyResource(orphan, manifest.stackId);
        if (removed) result.removed.push(removed);
        this.stateManager?.removeResource(manifest.stackId, orphan.id);
      } catch (error: unknown) {
        result.errors.push({
          id: orphan.id,
          type: orphan.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async deployResource(resource: ResourceManifest, stackId: string) {
    switch (resource.type) {
      case 'Stripe::Product':
        return this.deployProduct(resource, stackId);
      case 'Stripe::Price':
        return this.deployPrice(resource, stackId);
      case 'Stripe::Coupon':
        return this.deployCoupon(resource, stackId);
      case 'Stripe::EntitlementFeature':
        return this.deployEntitlementFeature(resource, stackId);
      case 'Stripe::BillingMeter':
        return this.deployBillingMeter(resource, stackId);
      default:
        throw new Error(`Unknown resource type: ${resource.type}`);
    }
  }

  private async deployProduct(resource: ResourceManifest, stackId: string) {
    // `features` is not a product field; it is applied through the product features API
    const { features, ...productProperties } = resource.properties;
    const props = validateProductCreateParams(productProperties);
    // undefined means the product does not manage its features: leave attachments as they are
    const desiredFeatureIds = (features as string[] | undefined)?.map((id) => this.logicalToPhysicalId.get(id) ?? id);
    const existing = await findProductForResource(this.stripe, resource, this.stateManager, stackId);

    if (existing) {
      // Check if properties have changed by comparing hash
      const desiredHash = StateManager.computePropertiesHash(resource.properties);
      const existingHash = existing.metadata?.pricectl_properties_hash as string | undefined;

      // The hash covers the definition only; a product archived by destroy has the same hash
      // but still needs to be brought back to its desired active state.
      const activeMatches = existing.active === (props.active ?? true);
      if (existingHash === desiredHash && activeMatches) {
        // Properties unchanged, return unchanged status
        return {
          id: resource.id,
          type: resource.type,
          physicalId: existing.id,
          status: 'unchanged' as const,
        };
      }

      // Update existing product
      const updated = await this.stripe.products.update(existing.id, {
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
          pricectl_properties_hash: desiredHash,
        },
      } as Stripe.ProductUpdateParams);
      if (desiredFeatureIds) {
        await this.syncProductFeatures(updated.id, desiredFeatureIds);
      }
      return {
        id: resource.id,
        type: resource.type,
        physicalId: updated.id,
        status: 'updated' as const,
      };
    } else {
      // Create new product
      const desiredHash = StateManager.computePropertiesHash(resource.properties);
      const created = await this.stripe.products.create({
        ...props,
        metadata: {
          ...props.metadata,
          pricectl_id: resource.id,
          pricectl_path: resource.path,
          pricectl_properties_hash: desiredHash,
        },
      });
      // A new product has no features attached yet
      for (const featureId of desiredFeatureIds ?? []) {
        await this.stripe.products.createFeature(created.id, { entitlement_feature: featureId });
      }
      return {
        id: resource.id,
        type: resource.type,
        physicalId: created.id,
        status: 'created' as const,
      };
    }
  }

  /** Attach the desired entitlement features to a product and detach all others. */
  private async syncProductFeatures(productId: string, desiredFeatureIds: string[]): Promise<void> {
    const attached = await listAttachedFeatures(this.stripe, productId);
    for (const featureId of desiredFeatureIds) {
      if (!attached.has(featureId)) {
        await this.stripe.products.createFeature(productId, { entitlement_feature: featureId });
      }
    }
    for (const [featureId, productFeatureId] of attached) {
      if (!desiredFeatureIds.includes(featureId)) {
        await this.stripe.products.deleteFeature(productId, productFeatureId);
      }
    }
  }

  private async deployPrice(resource: ResourceManifest, stackId: string) {
    // Resolve the product dependency
    const properties = this.resolveDependencies(resource.properties);
    const props = properties as unknown as Stripe.PriceCreateParams;

    const existing = await stripeFindExistingPrice(
      this.stripe,
      resource.id,
      this.stateManager,
      stackId,
    );

    if (existing) {
      // Check if properties match
      const propsMatch = isPriceEquivalent(existing, props);
      if (propsMatch) {
        // Metadata is mutable, so it is updated in place rather than by recreating the price
        const metadataUpdate = metadataChanges(stripInternalMetadata(existing.metadata) ?? {}, props.metadata || {});
        if (metadataUpdate === null) {
          return {
            id: resource.id,
            type: resource.type,
            physicalId: existing.id,
            status: 'unchanged' as const,
          };
        }
        await this.stripe.prices.update(existing.id, { metadata: metadataUpdate });
        return {
          id: resource.id,
          type: resource.type,
          physicalId: existing.id,
          status: 'updated' as const,
        };
      } else {
        // Create the replacement first so that a failure leaves the old price usable,
        // and take over its lookup key (Stripe allows a lookup key on only one price).
        const created = await this.stripe.prices.create({
          ...props,
          ...(props.lookup_key ? { transfer_lookup_key: true } : {}),
          metadata: {
            ...props.metadata,
            pricectl_id: resource.id,
            pricectl_path: resource.path,
          },
        });
        await this.stripe.prices.update(existing.id, { active: false });
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

  private async deployCoupon(resource: ResourceManifest, _stackId: string) {
    const props = resource.properties as unknown as Stripe.CouponCreateParams;
    const existing = await this.findExistingCoupon(resource.id);

    if (!existing) {
      const created = await this.stripe.coupons.create({
        ...props,
        id: resource.id,
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

    // Stripe can only update a coupon's name and metadata; refuse to silently drop other changes.
    const immutableChanges = IMMUTABLE_COUPON_FIELDS.filter(
      (field) => !isSameCouponValue(existing[field], props[field]),
    );
    if (immutableChanges.length > 0) {
      throw new Error(
        `Coupon "${resource.id}" cannot be updated: Stripe does not allow changing ${immutableChanges.join(', ')}. ` +
          'Give the coupon a new id to create a replacement.',
      );
    }

    const nameChanged = props.name !== undefined && props.name !== existing.name;
    const metadataUpdate = metadataChanges(stripInternalMetadata(existing.metadata) ?? {}, props.metadata || {});
    if (!nameChanged && metadataUpdate === null) {
      return {
        id: resource.id,
        type: resource.type,
        physicalId: existing.id,
        status: 'unchanged' as const,
      };
    }

    const updated = await this.stripe.coupons.update(existing.id, {
      ...(nameChanged ? { name: props.name } : {}),
      ...(metadataUpdate ? { metadata: metadataUpdate } : {}),
    });
    return {
      id: resource.id,
      type: resource.type,
      physicalId: updated.id,
      status: 'updated' as const,
    };
  }

  private async deployEntitlementFeature(resource: ResourceManifest, stackId: string) {
    const props = resource.properties as unknown as Stripe.Entitlements.FeatureCreateParams;

    // Only an active feature can be reused: Stripe rejects every update, including
    // reactivation, on an inactive feature, but allows a new one with the same lookup_key.
    const existing = await this.findActiveEntitlementFeature(resource.id, props.lookup_key, stackId);

    if (!existing) {
      const created = await this.stripe.entitlements.features.create({
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

    const nameChanged = props.name !== existing.name;
    const metadataUpdate = metadataChanges(stripInternalMetadata(existing.metadata) ?? {}, props.metadata ?? {});
    if (!nameChanged && metadataUpdate === null) {
      return {
        id: resource.id,
        type: resource.type,
        physicalId: existing.id,
        status: 'unchanged' as const,
      };
    }

    const updated = await this.stripe.entitlements.features.update(existing.id, {
      ...(nameChanged ? { name: props.name } : {}),
      ...(metadataUpdate ? { metadata: metadataUpdate } : {}),
    });
    return {
      id: resource.id,
      type: resource.type,
      physicalId: updated.id,
      status: 'updated' as const,
    };
  }

  private async deployBillingMeter(resource: ResourceManifest, stackId: string) {
    const props = resource.properties as unknown as Stripe.Billing.MeterCreateParams;

    // Try to find existing meter (state-based first, then by event_name)
    const existing = await this.findExistingBillingMeter(resource.id, props.event_name, stackId);

    if (!existing) {
      const created = await this.stripe.billing.meters.create(props);
      return {
        id: resource.id,
        type: resource.type,
        physicalId: created.id,
        status: 'created' as const,
      };
    }

    const inactive = existing.status !== 'active';
    const displayNameChanged = props.display_name !== existing.display_name;
    if (!inactive && !displayNameChanged) {
      return {
        id: resource.id,
        type: resource.type,
        physicalId: existing.id,
        status: 'unchanged' as const,
      };
    }

    // A meter deactivated by destroy is brought back; display_name is its only mutable field.
    if (inactive) {
      await this.stripe.billing.meters.reactivate(existing.id);
    }
    if (displayNameChanged) {
      await this.stripe.billing.meters.update(existing.id, { display_name: props.display_name });
    }
    return {
      id: resource.id,
      type: resource.type,
      physicalId: existing.id,
      status: 'updated' as const,
    };
  }

  private async findActiveEntitlementFeature(
    logicalId: string,
    lookupKey: string,
    stackId: string,
  ): Promise<Stripe.Entitlements.Feature | null> {
    // Try state-based lookup first
    if (this.stateManager) {
      const stateEntry = this.stateManager.getResource(stackId, logicalId);
      if (stateEntry?.physicalId) {
        try {
          const feature = await this.stripe.entitlements.features.retrieve(stateEntry.physicalId);
          if (feature.active) {
            return feature;
          }
          // Inactive features cannot be reused — fall through to listing
        } catch (error: unknown) {
          if (!isResourceNotFoundError(error)) {
            throw error;
          }
          // Physical ID from state is stale — fall through to listing
        }
      }
    }

    // Fall back to listing by lookup_key (the list also returns inactive features)
    for await (const feature of this.stripe.entitlements.features.list({ limit: 100 })) {
      if (feature.active && feature.lookup_key === lookupKey) {
        return feature;
      }
    }
    return null;
  }

  private async findExistingBillingMeter(
    logicalId: string,
    eventName: string,
    stackId: string,
  ): Promise<Stripe.Billing.Meter | null> {
    // Try state-based lookup first
    if (this.stateManager) {
      const stateEntry = this.stateManager.getResource(stackId, logicalId);
      if (stateEntry?.physicalId) {
        try {
          return await this.stripe.billing.meters.retrieve(stateEntry.physicalId);
        } catch (error: unknown) {
          if (!isResourceNotFoundError(error)) {
            throw error;
          }
          // Physical ID from state is stale — fall through to listing
        }
      }
    }

    // Fall back to listing by event_name, preferring an active meter
    // (Billing Meters don't support metadata, so event_name is the natural key)
    let inactiveMatch: Stripe.Billing.Meter | null = null;
    for await (const meter of this.stripe.billing.meters.list({ limit: 100 })) {
      if (meter.event_name !== eventName) continue;
      if (meter.status === 'active') return meter;
      inactiveMatch = inactiveMatch ?? meter;
    }
    return inactiveMatch;
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

    // Resolve meter reference in a metered Price
    const recurring = resolved.recurring as Record<string, unknown> | undefined;
    if (recurring && typeof recurring.meter === 'string') {
      const physicalId = this.logicalToPhysicalId.get(recurring.meter);
      if (physicalId) {
        resolved.recurring = { ...recurring, meter: physicalId };
      }
    }

    return resolved;
  }

  private async hasPrices(productId: string): Promise<boolean> {
    for await (const _price of this.stripe.prices.list({ product: productId, limit: 1 })) {
      return true;
    }
    return false;
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


  async destroy(manifest: StackManifest): Promise<DestroyResult> {
    const result: DestroyResult = {
      stackId: manifest.stackId,
      destroyed: [],
      errors: [],
    };

    // Delete resources in reverse order to handle dependencies, and also clean up
    // resources that are only left in the state file because they were removed from the code
    const resources = [...findOrphans(manifest, this.stateManager), ...[...manifest.resources].reverse()];

    for (const resource of resources) {
      try {
        const destroyed = await this.destroyResource(resource, manifest.stackId);
        if (destroyed) {
          result.destroyed.push(destroyed);
        }

        // Always clean state when destroyResource succeeds (even if resource was already gone)
        if (this.stateManager) {
          this.stateManager.removeResource(manifest.stackId, resource.id);
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

  private async destroyResource(resource: ResourceManifest, stackId: string): Promise<{
    id: string;
    type: string;
    status: 'deleted' | 'deactivated';
  } | null> {
    switch (resource.type) {
      case 'Stripe::Product': {
        const existing = await stripeFindExistingProduct(
          this.stripe,
          resource.id,
          this.stateManager,
          stackId,
        );
        if (existing) {
          // Stripe refuses to delete a product that has prices, and prices cannot be deleted,
          // so such a product is archived instead.
          if (await this.hasPrices(existing.id)) {
            await this.stripe.products.update(existing.id, { active: false });
            return {
              id: resource.id,
              type: resource.type,
              status: 'deactivated',
            };
          }
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
        const existing = await stripeFindExistingPrice(
          this.stripe,
          resource.id,
          this.stateManager,
          stackId,
        );
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
      case 'Stripe::EntitlementFeature': {
        const featureProps = resource.properties as unknown as { lookup_key: string };
        const existing = await this.findActiveEntitlementFeature(resource.id, featureProps.lookup_key, stackId);
        if (existing) {
          // Features are deactivated, not deleted
          await this.stripe.entitlements.features.update(existing.id, { active: false });
          return {
            id: resource.id,
            type: resource.type,
            status: 'deactivated',
          };
        }
        return null;
      }
      case 'Stripe::BillingMeter': {
        const meterProps = resource.properties as unknown as { event_name: string };
        const existing = await this.findExistingBillingMeter(resource.id, meterProps.event_name, stackId);
        if (existing) {
          // Meters are deactivated, not deleted
          await this.stripe.billing.meters.deactivate(existing.id);
          return {
            id: resource.id,
            type: resource.type,
            status: 'deactivated',
          };
        }
        return null;
      }
      default:
        throw new Error(`Unknown resource type: ${resource.type}`);
    }
  }
}
