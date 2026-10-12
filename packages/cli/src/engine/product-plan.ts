import type Stripe from 'stripe';
import { metadataChanges, userMetadata } from './metadata';

/** What the definition says about one product. */
export interface ProductDefinition {
  logicalId: string;
  /** `{stackId}_{logicalId}`: the product ID pricectl creates it with */
  key: string;
  params: Stripe.ProductCreateParams;
  /**
   * Stripe IDs of the entitlement features the product grants. Undefined when the definition
   * does not manage them: attachments are then left as they are.
   */
  desiredFeatureIds?: string[];
}

/** What `plan` read from Stripe for one product. */
export interface ProductObservation {
  /** The product with the derived ID (or the adopted one), if it exists */
  product?: Stripe.Product;
  /** Attached entitlement feature ID → the product feature ID that detaches it */
  attachedFeatures: Map<string, string>;
}

/** One change to Stripe for a product. */
export type ProductStep =
  | { kind: 'createProduct'; params: Stripe.ProductCreateParams & { id: string } }
  | { kind: 'updateProduct'; productId: string; changes: Stripe.ProductUpdateParams }
  | { kind: 'attachFeature'; productId: string; featureId: string }
  | { kind: 'detachFeature'; productId: string; productFeatureId: string }
  | { kind: 'deleteProduct'; productId: string }
  | { kind: 'archiveProduct'; productId: string };

/** The scalar fields a definition can set on a product, as the product API names them. */
const FIELDS = ['name', 'active', 'description', 'url', 'unit_label', 'statement_descriptor', 'tax_code'] as const;

function sameValue(existing: unknown, desired: unknown): boolean {
  return (existing ?? null) === (desired ?? null);
}

/** The fields of an existing product that differ from the ones the definition sets. */
function fieldChanges(existing: Stripe.Product, params: Stripe.ProductCreateParams): Stripe.ProductUpdateParams {
  const changes: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (params[field] !== undefined && !sameValue(existing[field], params[field])) changes[field] = params[field];
  }
  if (params.images !== undefined && JSON.stringify(existing.images ?? []) !== JSON.stringify(params.images)) {
    changes.images = params.images;
  }
  const metadata = metadataChanges(userMetadata(existing.metadata), userMetadata(params.metadata));
  if (Object.keys(metadata).length > 0) changes.metadata = metadata;
  return changes;
}

function featureSteps(productId: string, definition: ProductDefinition, attached: Map<string, string>): ProductStep[] {
  const desired = definition.desiredFeatureIds;
  if (desired === undefined) return [];
  const steps: ProductStep[] = [];
  for (const featureId of desired) {
    if (!attached.has(featureId)) steps.push({ kind: 'attachFeature', productId, featureId });
  }
  for (const [featureId, productFeatureId] of attached) {
    if (!desired.includes(featureId)) steps.push({ kind: 'detachFeature', productId, productFeatureId });
  }
  return steps;
}

/**
 * The steps that bring a product in line with its definition. A new product gets the ID
 * pricectl derives for it, so the next plan finds it by that ID. Fields the definition does not
 * set are left as they are in Stripe.
 */
export function planProduct(stackId: string, definition: ProductDefinition, observation: ProductObservation): ProductStep[] {
  const { product } = observation;
  if (!product) {
    return [
      {
        kind: 'createProduct',
        params: {
          ...definition.params,
          id: definition.key,
          metadata: {
            ...userMetadata(definition.params.metadata),
            pricectl_stack: stackId,
            pricectl_id: definition.logicalId,
          },
        },
      },
      ...featureSteps(definition.key, definition, new Map()),
    ];
  }

  const changes = fieldChanges(product, definition.params);
  const update: ProductStep[] =
    Object.keys(changes).length > 0 ? [{ kind: 'updateProduct', productId: product.id, changes }] : [];
  return [...update, ...featureSteps(product.id, definition, observation.attachedFeatures)];
}

/**
 * The step that removes a product: delete it, or archive it when it has prices, because Stripe
 * refuses to delete a product with prices and prices cannot be deleted.
 */
export function planProductRemoval(product: Stripe.Product, hasPrices: boolean): ProductStep[] {
  if (!hasPrices) return [{ kind: 'deleteProduct', productId: product.id }];
  return product.active ? [{ kind: 'archiveProduct', productId: product.id }] : [];
}
