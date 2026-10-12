import type Stripe from 'stripe';
import type { ResourceManifest, StackManifest } from '@pricectl/core';
import type { LockFile } from './lock';
import type { PriceObservation } from './price-plan';
import type { ProductObservation } from './product-plan';
import { indexResources, priceLookupKeyOf, productIdOf, resolveProductRef } from './refs';
import { listAttachedFeatures } from './stripe-utils';

/** Stripe allows at most this many lookup keys in one price list call. */
const LOOKUP_KEYS_PER_CALL = 10;

/** What a price slot looks like in Stripe: its versions and the default price of the products they sit on. */
export type PriceSlot = Pick<PriceObservation, 'versions' | 'defaultPriceIds'>;

/** What `plan` read from Stripe for the resources of the definition. */
export interface Observations {
  /** By logical ID */
  products: Map<string, ProductObservation>;
  prices: Map<string, PriceObservation>;
  coupons: Map<string, Stripe.Coupon | undefined>;
  features: Map<string, Stripe.Entitlements.Feature | undefined>;
  /** Every active billing meter: meters cannot be looked up by event name */
  activeMeters: Stripe.Billing.Meter[];
  /** Meters a definition adopts by Stripe ID, by logical ID, whatever their state */
  adoptedMeters: Map<string, Stripe.Billing.Meter>;
  /** What a removed key left in Stripe, by key */
  removed: {
    products: Map<string, { product: Stripe.Product; hasPrices: boolean } | undefined>;
    prices: Map<string, PriceSlot>;
    coupons: Map<string, Stripe.Coupon | undefined>;
    features: Map<string, Stripe.Entitlements.Feature | undefined>;
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'resource_missing';
}

async function orUndefined<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** The keys the lock marks as removing for a type. */
export function removingKeys(lock: LockFile, stackId: string, type: string): string[] {
  return Object.entries(lock.stacks[stackId]?.[type] ?? {})
    .filter(([, entry]) => entry === 'removing')
    .map(([key]) => key);
}

async function readProduct(stripe: Stripe, resource: ResourceManifest): Promise<ProductObservation> {
  const product = await orUndefined(stripe.products.retrieve(productIdOf(resource)));
  if (!product && resource.physicalId) {
    throw new Error(`Product ${resource.physicalId} of "${resource.id}" does not exist in Stripe.`);
  }
  const manages = resource.properties.features !== undefined;
  return {
    product: product && !product.deleted ? product : undefined,
    attachedFeatures: product && manages ? await listAttachedFeatures(stripe, product.id) : new Map(),
  };
}

async function readFeature(stripe: Stripe, resource: ResourceManifest): Promise<Stripe.Entitlements.Feature | undefined> {
  if (resource.physicalId) return stripe.entitlements.features.retrieve(resource.physicalId);
  return readFeatureByKey(stripe, resource.properties.lookup_key as string);
}

/** The active feature with a lookup key; Stripe allows one. */
async function readFeatureByKey(stripe: Stripe, lookupKey: string): Promise<Stripe.Entitlements.Feature | undefined> {
  const page = await stripe.entitlements.features.list({ lookup_key: lookupKey, archived: false, limit: 1 });
  return page.data[0];
}

async function readActiveMeters(stripe: Stripe): Promise<Stripe.Billing.Meter[]> {
  const meters: Stripe.Billing.Meter[] = [];
  for await (const meter of stripe.billing.meters.list({ status: 'active', limit: 100 })) meters.push(meter);
  return meters;
}

/** The prices holding the given lookup keys, whatever their state. */
async function readHolders(stripe: Stripe, keys: string[]): Promise<Map<string, Stripe.Price>> {
  const holders = new Map<string, Stripe.Price>();
  for (let i = 0; i < keys.length; i += LOOKUP_KEYS_PER_CALL) {
    const chunk = keys.slice(i, i + LOOKUP_KEYS_PER_CALL);
    for await (const price of stripe.prices.list({ lookup_keys: chunk, limit: 100, expand: ['data.tiers'] })) {
      if (price.lookup_key) holders.set(price.lookup_key, price);
    }
  }
  return holders;
}

/**
 * The stack's own versions of a slot: the holder and the prices reached from it through
 * `pricectl_previous`, newest first. A holder the stack does not own has no versions of ours.
 */
async function readVersions(stripe: Stripe, stackId: string, holder: Stripe.Price): Promise<Stripe.Price[]> {
  if (holder.metadata?.pricectl_stack !== stackId) return [];
  const versions = [holder];
  const seen = new Set([holder.id]);
  let previous = holder.metadata.pricectl_previous;
  while (previous && !seen.has(previous)) {
    const version = await orUndefined(stripe.prices.retrieve(previous, { expand: ['tiers'] }));
    if (!version) break;
    versions.push(version);
    seen.add(version.id);
    previous = version.metadata?.pricectl_previous;
  }
  return versions;
}

/** `default_price` of each product, null when unset or when the product does not exist. */
async function readDefaultPrices(stripe: Stripe, productIds: Iterable<string>): Promise<Record<string, string | null>> {
  const defaults: Record<string, string | null> = {};
  for (const productId of new Set(productIds)) {
    const product = await orUndefined(stripe.products.retrieve(productId));
    const price = product && !product.deleted ? product.default_price : null;
    defaults[productId] = typeof price === 'string' ? price : (price?.id ?? null);
  }
  return defaults;
}

function productOf(price: Stripe.Price): string {
  return typeof price.product === 'string' ? price.product : price.product.id;
}

async function readSlot(stripe: Stripe, stackId: string, holder: Stripe.Price | undefined, extraProducts: string[] = []): Promise<PriceObservation> {
  const versions = holder ? await readVersions(stripe, stackId, holder) : [];
  const defaultPriceIds = await readDefaultPrices(stripe, [...versions.map(productOf), ...extraProducts]);
  return { holder, versions, defaultPriceIds };
}

/**
 * Read from Stripe what plan needs, finding every object by its key: products and coupons by the
 * ID pricectl gave them, features and prices by lookup key, meters among the active ones. Nothing
 * is listed beyond that, so the cost does not grow with the account.
 */
export async function readObservations(stripe: Stripe, manifest: StackManifest, lock: LockFile): Promise<Observations> {
  const { stackId } = manifest;
  const resources = indexResources(manifest);
  const ofType = (type: string) => manifest.resources.filter((r) => r.type === type);
  const removing = (type: string) => removingKeys(lock, stackId, type);

  const observations: Observations = {
    products: new Map(),
    prices: new Map(),
    coupons: new Map(),
    features: new Map(),
    activeMeters: [],
    adoptedMeters: new Map(),
    removed: { products: new Map(), prices: new Map(), coupons: new Map(), features: new Map() },
  };

  for (const resource of ofType('Stripe::Product')) observations.products.set(resource.id, await readProduct(stripe, resource));
  for (const resource of ofType('Stripe::Coupon')) {
    observations.coupons.set(resource.id, await orUndefined(stripe.coupons.retrieve(resource.key)));
  }
  for (const resource of ofType('Stripe::EntitlementFeature')) observations.features.set(resource.id, await readFeature(stripe, resource));
  if (ofType('Stripe::BillingMeter').length > 0 || removing('Stripe::BillingMeter').length > 0) {
    observations.activeMeters = await readActiveMeters(stripe);
  }

  for (const resource of ofType('Stripe::BillingMeter')) {
    if (resource.physicalId) {
      observations.adoptedMeters.set(resource.id, await stripe.billing.meters.retrieve(resource.physicalId));
    }
  }

  const prices = ofType('Stripe::Price');
  const removedPriceKeys = removing('Stripe::Price');
  const holders = await readHolders(stripe, [...prices.map(priceLookupKeyOf), ...removedPriceKeys]);
  for (const resource of prices) {
    const product = resolveProductRef(resources, resource.properties.product as string);
    observations.prices.set(resource.id, await readSlot(stripe, stackId, holders.get(priceLookupKeyOf(resource)), [product]));
  }
  for (const key of removedPriceKeys) {
    const { versions, defaultPriceIds } = await readSlot(stripe, stackId, holders.get(key));
    observations.removed.prices.set(key, { versions, defaultPriceIds });
  }

  for (const key of removing('Stripe::Product')) {
    const product = await orUndefined(stripe.products.retrieve(key));
    const hasPrices = product ? (await stripe.prices.list({ product: key, limit: 1 })).data.length > 0 : false;
    observations.removed.products.set(key, product && !product.deleted ? { product, hasPrices } : undefined);
  }
  for (const key of removing('Stripe::Coupon')) observations.removed.coupons.set(key, await orUndefined(stripe.coupons.retrieve(key)));
  for (const key of removing('Stripe::EntitlementFeature')) observations.removed.features.set(key, await readFeatureByKey(stripe, key));
  return observations;
}
