import type Stripe from 'stripe';
import { metadataChanges, userMetadata } from './metadata';

/** What the definition says about one entitlement feature. */
export interface FeatureDefinition {
  logicalId: string;
  /** The feature's lookup key */
  key: string;
  params: Stripe.Entitlements.FeatureCreateParams;
}

/** One change to Stripe for an entitlement feature. */
export type FeatureStep =
  | { kind: 'createFeature'; params: Stripe.Entitlements.FeatureCreateParams }
  | { kind: 'updateFeature'; featureId: string; changes: Stripe.Entitlements.FeatureUpdateParams }
  | { kind: 'deactivateFeature'; featureId: string };

export interface FeaturePlan {
  steps: FeatureStep[];
  /** Why no step may be taken, when the plan has to be refused */
  refusal?: string;
}

/**
 * The steps that bring a feature in line with its definition. Only an active feature can be
 * reused: Stripe rejects every update, including reactivation, on an inactive one.
 */
export function planFeature(
  stackId: string,
  definition: FeatureDefinition,
  existing: Stripe.Entitlements.Feature | undefined,
): FeaturePlan {
  const { params } = definition;
  if (!existing) {
    return {
      steps: [
        {
          kind: 'createFeature',
          params: {
            ...params,
            metadata: {
              ...userMetadata(params.metadata),
              pricectl_stack: stackId,
              pricectl_id: definition.logicalId,
            },
          },
        },
      ],
    };
  }
  if (!existing.active) {
    return {
      steps: [],
      refusal: `Feature ${existing.id} is inactive, and Stripe does not allow updating inactive features.`,
    };
  }

  const changes: Stripe.Entitlements.FeatureUpdateParams = {};
  if (params.name !== existing.name) changes.name = params.name;
  const metadata = metadataChanges(userMetadata(existing.metadata), userMetadata(params.metadata));
  if (Object.keys(metadata).length > 0) changes.metadata = metadata;
  return {
    steps: Object.keys(changes).length > 0 ? [{ kind: 'updateFeature', featureId: existing.id, changes }] : [],
  };
}

/** The step that removes a feature: features are deactivated, not deleted. */
export function planFeatureRemoval(existing: Stripe.Entitlements.Feature | undefined): FeatureStep[] {
  return existing?.active ? [{ kind: 'deactivateFeature', featureId: existing.id }] : [];
}
