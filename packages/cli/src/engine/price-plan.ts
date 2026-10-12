import type Stripe from 'stripe';
import { metadataChanges, userMetadata } from './metadata';
import { arePriceTermsEqual } from './price-comparison';

/** What the definition says about one price slot. */
export interface PriceDefinition {
  /** Logical ID of the price in the definition */
  logicalId: string;
  /** `{stackId}_{logicalId}`: the lookup key when the definition sets none */
  key: string;
  /** Declared as the default price of its product */
  isDefault: boolean;
  /** Stripe create params; `product` is a Stripe product ID */
  params: Stripe.PriceCreateParams;
}

/** What `plan` read from Stripe for one price slot. */
export interface PriceObservation {
  /** The price that holds the slot's lookup key now, if any */
  holder?: Stripe.Price;
  /**
   * The stack's own versions of the slot: the holder (when it belongs to the stack) and the
   * prices reached from it through `pricectl_previous`, newest first. Empty when the holder
   * is outside the stack.
   */
  versions: Stripe.Price[];
  /** `default_price` of each product that matters here (null when unset) */
  defaultPriceIds: Record<string, string | null>;
}

/** One change to Stripe, in the order it must be made. */
export type PriceStep =
  | { kind: 'create'; params: Stripe.PriceCreateParams }
  | { kind: 'update'; priceId: string; changes: Stripe.PriceUpdateParams }
  /** `priceId` null means the price created by this plan */
  | { kind: 'setDefault'; productId: string; priceId: string | null }
  | { kind: 'unsetDefault'; productId: string }
  | { kind: 'archive'; priceId: string };

export interface PricePlan {
  steps: PriceStep[];
  /** Why no step may be taken, when the plan has to be refused */
  refusal?: string;
}

function productIdOf(price: Stripe.Price): string {
  const product = price.product as string | { id: string };
  return typeof product === 'string' ? product : product.id;
}

function taxOf(price: Stripe.Price): string {
  return price.tax_behavior ?? 'unspecified';
}

/** Whether an existing version can be updated in place into the definition. */
function isReusable(holder: Stripe.Price, params: Stripe.PriceCreateParams): boolean {
  const desiredTax = params.tax_behavior ?? 'unspecified';
  return arePriceTermsEqual(holder, params) && (taxOf(holder) === desiredTax || taxOf(holder) === 'unspecified');
}

/** The fields of an existing price that differ from the definition and can be updated in place. */
function inPlaceChanges(price: Stripe.Price, params: Stripe.PriceCreateParams): Stripe.PriceUpdateParams {
  const changes: Stripe.PriceUpdateParams = {};
  const active = params.active ?? true;
  if (price.active !== active) changes.active = active;
  if ((price.nickname ?? '') !== (params.nickname ?? '')) changes.nickname = params.nickname ?? '';
  const tax = params.tax_behavior ?? 'unspecified';
  if (taxOf(price) !== tax) changes.tax_behavior = tax;
  const metadata = metadataChanges(userMetadata(price.metadata), params.metadata ? userMetadata(params.metadata) : {});
  if (Object.keys(metadata).length > 0) changes.metadata = metadata;
  return changes;
}

function createStep(stackId: string, definition: PriceDefinition, holder: Stripe.Price | undefined, owned: boolean): PriceStep {
  const { params } = definition;
  return {
    kind: 'create',
    params: {
      ...params,
      lookup_key: params.lookup_key ?? definition.key,
      // The key moves to the new price; Stripe refuses to create it otherwise
      ...(holder ? { transfer_lookup_key: true } : {}),
      metadata: {
        ...userMetadata(params.metadata),
        pricectl_stack: stackId,
        pricectl_id: definition.logicalId,
        ...(holder && owned ? { pricectl_previous: holder.id } : {}),
      },
    },
  };
}

/**
 * Default-price steps that must come before a version is taken off sale: Stripe refuses to
 * archive a product's default price. A version that is the default follows the slot to its
 * target when the target is on sale and belongs to the same product; otherwise the default is unset.
 */
function defaultPriceSteps(
  definition: PriceDefinition,
  observation: PriceObservation,
  target: Stripe.Price | undefined,
): PriceStep[] {
  const steps: PriceStep[] = [];
  const productId = definition.params.product as string;
  const targetOnSale = definition.params.active ?? true;
  const versionIds = new Set(observation.versions.map((v) => v.id));
  const products = new Set([productId, ...observation.versions.map(productIdOf)]);

  for (const product of products) {
    const current = observation.defaultPriceIds[product] ?? null;
    if (product === productId && definition.isDefault) {
      if (current === null || current !== target?.id) steps.push({ kind: 'setDefault', productId: product, priceId: target?.id ?? null });
    } else if (current !== null && versionIds.has(current)) {
      const follows = product === productId && targetOnSale;
      if (follows && current !== target?.id) {
        steps.push({ kind: 'setDefault', productId: product, priceId: target?.id ?? null });
      } else if (!follows) {
        steps.push({ kind: 'unsetDefault', productId: product });
      }
    }
  }
  return steps;
}

/**
 * The steps that bring one price slot in line with its definition, in the order Stripe accepts:
 * update the key holder in place when it can be, otherwise create a new version that takes the
 * key; fix the product's default price; archive every other version still on sale.
 * A key held by a price outside the stack is refused unless the definition allows taking it.
 */
export function planPrice(stackId: string, definition: PriceDefinition, observation: PriceObservation): PricePlan {
  const { holder } = observation;
  const owned = holder?.metadata?.pricectl_stack === stackId;

  if (holder && !owned && !definition.params.transfer_lookup_key) {
    const key = definition.params.lookup_key ?? definition.key;
    return {
      steps: [],
      refusal:
        `The lookup key "${key}" of ${definition.logicalId} is held by price ${holder.id}, which pricectl does not manage. ` +
        'Set transferLookupKey: true on the price to take the key over.',
    };
  }

  const reuse = owned && holder !== undefined && isReusable(holder, definition.params);
  const target = reuse ? holder : undefined;
  const steps: PriceStep[] = [];

  if (!reuse) steps.push(createStep(stackId, definition, holder, owned));

  const changes = target ? inPlaceChanges(target, definition.params) : {};
  const update: PriceStep[] = Object.keys(changes).length > 0 && target ? [{ kind: 'update', priceId: target.id, changes }] : [];
  const deactivates = changes.active === false;
  if (!deactivates) steps.push(...update);
  steps.push(...defaultPriceSteps(definition, observation, target));
  if (deactivates) steps.push(...update);

  for (const version of observation.versions) {
    if (version.id !== target?.id && version.active) steps.push({ kind: 'archive', priceId: version.id });
  }
  return { steps };
}

/**
 * The steps that take a removed slot off sale: unset the product default where a version is
 * the default, then archive each version that is on sale.
 */
export function planPriceRemoval(versions: Stripe.Price[], defaultPriceIds: Record<string, string | null>): PriceStep[] {
  const steps: PriceStep[] = [];
  for (const version of versions.filter((v) => v.active)) {
    const productId = productIdOf(version);
    if (defaultPriceIds[productId] === version.id) steps.push({ kind: 'unsetDefault', productId });
    steps.push({ kind: 'archive', priceId: version.id });
  }
  return steps;
}
