import type Stripe from 'stripe';
import type { ResourceManifest, StackManifest } from '@pricectl/core';
import { planCoupon, planCouponRemoval } from './coupon-plan';
import { planFeature, planFeatureRemoval } from './feature-plan';
import type { LockFile } from './lock';
import { planMeter, planMeterRemoval } from './meter-plan';
import { operationOf, Plan, PlanItem, Step } from './plan';
import { planPrice, planPriceRemoval } from './price-plan';
import { planProduct, planProductRemoval, ProductObservation } from './product-plan';
import { indexResources, priceLookupKeyOf, resolveFeatureRef, resolveMeterRef, resolveProductRef } from './refs';
import { Observations, readObservations, removingKeys } from './read-stripe';

/** The order resources are created in: what others refer to comes first. */
const APPLY_ORDER = [
  'Stripe::BillingMeter',
  'Stripe::EntitlementFeature',
  'Stripe::Product',
  'Stripe::Coupon',
  'Stripe::Price',
];

/** The order removed resources are taken out in: the reverse, so references go before their targets. */
const REMOVAL_ORDER = [...APPLY_ORDER].reverse();

/** What Stripe accepts as the ID of a product or coupon chosen by the caller (observed in test mode). */
const STRIPE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_LOOKUP_KEY_LENGTH = 200;

/** Why Stripe would reject the ID pricectl derives for a new product or coupon, found before anything is changed. */
function idRefusal(resource: ResourceManifest): string | undefined {
  if (STRIPE_ID.test(resource.key)) return undefined;
  return (
    `The ID "${resource.key}" that pricectl derives for "${resource.path}" is not accepted by Stripe: ` +
    'use letters, digits, "_" and "-" (up to 200 characters) in the stack ID and the logical ID.'
  );
}

/** Why an object found by its key cannot be used: it carries the tag of another stack. */
function ownershipRefusal(resource: ResourceManifest, existing: { id: string; metadata?: Record<string, string> | null } | undefined, stackId: string): string | undefined {
  if (!existing || resource.physicalId) return undefined;
  const tag = existing.metadata?.pricectl_stack;
  if (!tag || tag === stackId) return undefined;
  return (
    `${existing.id} for "${resource.path}" belongs to stack "${tag}", not "${stackId}". ` +
    'Give one of the stacks another stack ID or the resource another logical ID.'
  );
}

/**
 * Work out what `deploy` would do, reading Stripe by key only. Nothing is changed. Deploy applies
 * the plan it shows, so every step names the Stripe objects this read found.
 */
export async function buildPlan(stripe: Stripe, manifest: StackManifest, lock: LockFile): Promise<Plan> {
  return composePlan(manifest, lock, await readObservations(stripe, manifest, lock));
}

/** Combine the definition, the lock and what Stripe holds into a plan. */
export function composePlan(manifest: StackManifest, lock: LockFile, observations: Observations): Plan {
  const resources = indexResources(manifest);
  const declared = declaredDefaultProducts(manifest, resources);
  // A price that declares the default of its product goes first, so that the other prices
  // of the product can be archived without being the default
  const defined = [...manifest.resources].sort(
    (a, b) =>
      APPLY_ORDER.indexOf(a.type) - APPLY_ORDER.indexOf(b.type) ||
      Number(b.type === 'Stripe::Price' && Boolean(b.isDefault)) - Number(a.type === 'Stripe::Price' && Boolean(a.isDefault)),
  );
  const items = defined.map((resource) => withDeclaredDefaults(resource, planResource(manifest.stackId, resource, resources, observations), declared));

  const settled = new Set([...declared, ...items.flatMap((item) => item.steps.flatMap(defaultPriceProduct))]);
  const referenced = referencedStripeIds(manifest);
  const removed = REMOVAL_ORDER.flatMap((type) => removalItems(manifest.stackId, type, lock, observations, referenced, settled));
  return { stackId: manifest.stackId, items: [...items, ...removed] };
}

/** The products whose default price a price of the definition declares. */
function declaredDefaultProducts(manifest: StackManifest, resources: Map<string, ResourceManifest>): Set<string> {
  return new Set(
    manifest.resources
      .filter((resource) => resource.type === 'Stripe::Price' && resource.isDefault)
      .map((resource) => resolveProductRef(resources, resource.properties.product as string)),
  );
}

/** The product a step sets or unsets the default price of, as a list of at most one. */
function defaultPriceProduct(step: Step): string[] {
  return step.kind === 'setDefault' || step.kind === 'unsetDefault' ? [step.productId] : [];
}

/**
 * The price that declares the default of a product decides it. Another price of that product
 * must not move the default on its own: it would work from the default Stripe has now, which the
 * declaring price is about to change.
 */
function withDeclaredDefaults(resource: ResourceManifest, item: PlanItem, declared: Set<string>): PlanItem {
  if (resource.type !== 'Stripe::Price' || resource.isDefault) return item;
  const steps = item.steps.filter((step) => !defaultPriceProduct(step).some((product) => declared.has(product)));
  return steps.length === item.steps.length ? item : { ...item, steps, operation: item.refusal ? item.operation : operationOf(steps) };
}

function item(resource: ResourceManifest, steps: Step[], extra: Partial<PlanItem> = {}): PlanItem {
  return { id: resource.id, path: resource.path, type: resource.type, operation: operationOf(steps), steps, ...extra };
}

function planResource(
  stackId: string,
  resource: ResourceManifest,
  resources: Map<string, ResourceManifest>,
  observations: Observations,
): PlanItem {
  switch (resource.type) {
    case 'Stripe::BillingMeter':
      return planMeterResource(resource, observations);
    case 'Stripe::EntitlementFeature':
      return planFeatureResource(stackId, resource, observations);
    case 'Stripe::Product':
      return planProductResource(stackId, resource, resources, observations);
    case 'Stripe::Coupon':
      return planCouponResource(stackId, resource, observations);
    case 'Stripe::Price':
      return planPriceResource(stackId, resource, resources, observations);
    default:
      return item(resource, [], { refusal: `Unknown resource type: ${resource.type}` });
  }
}

function planMeterResource(resource: ResourceManifest, observations: Observations): PlanItem {
  const params = resource.properties as unknown as Stripe.Billing.MeterCreateParams;
  const adopted = observations.adoptedMeters.get(resource.id);
  if (adopted) {
    if (adopted.event_name !== params.event_name) {
      return item(resource, [], {
        physicalId: adopted.id,
        refusal:
          `Meter ${adopted.id} has event_name "${adopted.event_name}", but "${resource.id}" defines "${params.event_name}"; ` +
          'Stripe does not allow changing event_name.',
      });
    }
    if (adopted.status !== 'active') {
      return item(resource, [], { physicalId: adopted.id, refusal: `Meter ${adopted.id} is inactive, and Stripe does not allow reactivating it while it is adopted.` });
    }
    return item(resource, planMeter(params, [adopted]), { physicalId: adopted.id });
  }
  const existing = observations.activeMeters.find((meter) => meter.event_name === params.event_name);
  return item(resource, planMeter(params, observations.activeMeters), { physicalId: existing?.id });
}

function planFeatureResource(stackId: string, resource: ResourceManifest, observations: Observations): PlanItem {
  const params = resource.properties as unknown as Stripe.Entitlements.FeatureCreateParams;
  const existing = observations.features.get(resource.id);
  const foreign = ownershipRefusal(resource, existing, stackId);
  if (foreign) return item(resource, [], { physicalId: existing?.id, refusal: foreign });
  if (resource.physicalId && existing && existing.lookup_key !== params.lookup_key) {
    return item(resource, [], {
      physicalId: existing.id,
      refusal:
        `Feature ${existing.id} has lookup_key "${existing.lookup_key}", but "${resource.id}" defines "${params.lookup_key}"; ` +
        'Stripe does not allow changing lookup_key.',
    });
  }
  const plan = planFeature(stackId, { logicalId: resource.id, key: params.lookup_key, params, adopted: Boolean(resource.physicalId) }, existing);
  return item(resource, plan.steps, { physicalId: existing?.id, refusal: plan.refusal });
}

function planProductResource(
  stackId: string,
  resource: ResourceManifest,
  resources: Map<string, ResourceManifest>,
  observations: Observations,
): PlanItem {
  const { features, ...params } = resource.properties;
  const observation: ProductObservation = observations.products.get(resource.id) ?? { attachedFeatures: new Map() };
  const refusal = observation.product || resource.physicalId ? ownershipRefusal(resource, observation.product, stackId) : idRefusal(resource);
  if (refusal) return item(resource, [], { physicalId: observation.product?.id, refusal });
  const desiredFeatureIds = (features as string[] | undefined)?.map((ref) => resolveFeatureRef(ref, resources, observations));
  const steps = planProduct(
    stackId,
    { logicalId: resource.id, key: resource.key, params: params as unknown as Stripe.ProductCreateParams, desiredFeatureIds, adopted: Boolean(resource.physicalId) },
    observation,
  );
  return item(resource, steps, { physicalId: observation.product?.id });
}

function planCouponResource(stackId: string, resource: ResourceManifest, observations: Observations): PlanItem {
  const existing = observations.coupons.get(resource.id);
  const refusal = existing ? ownershipRefusal(resource, existing, stackId) : idRefusal(resource);
  if (refusal) return item(resource, [], { physicalId: existing?.id, refusal });
  const plan = planCoupon(
    stackId,
    { logicalId: resource.id, key: resource.key, params: resource.properties as unknown as Stripe.CouponCreateParams },
    existing,
  );
  return item(resource, plan.steps, { physicalId: existing?.id, refusal: plan.refusal });
}

function planPriceResource(
  stackId: string,
  resource: ResourceManifest,
  resources: Map<string, ResourceManifest>,
  observations: Observations,
): PlanItem {
  const properties = resource.properties as unknown as Stripe.PriceCreateParams;
  const params: Stripe.PriceCreateParams = {
    ...properties,
    product: resolveProductRef(resources, properties.product as string),
  };
  const meterRef = properties.recurring?.meter;
  if (params.recurring && meterRef) {
    params.recurring = { ...params.recurring, meter: resolveMeterRef(meterRef, resources, observations) };
  }
  const observation = observations.prices.get(resource.id) ?? { versions: [], defaultPriceIds: {} };
  const lookupKey = priceLookupKeyOf(resource);
  if (lookupKey.length > MAX_LOOKUP_KEY_LENGTH) {
    return item(resource, [], {
      refusal: `The lookup key "${lookupKey.slice(0, 40)}..." of "${resource.path}" is longer than the ${MAX_LOOKUP_KEY_LENGTH} characters Stripe allows.`,
    });
  }
  const plan = planPrice(
    stackId,
    { logicalId: resource.id, key: priceLookupKeyOf(resource), isDefault: Boolean(resource.isDefault), params },
    observation,
  );
  return item(resource, plan.steps, { physicalId: observation.holder?.id, refusal: plan.refusal });
}

/**
 * Stripe IDs that defined resources refer to directly (a price on a product, a product with a
 * feature, a price on a meter) instead of through a resource of the definition. Such an object is
 * no longer the stack's to remove, even though the lock still names it.
 */
function referencedStripeIds(manifest: StackManifest): Set<string> {
  const logicalIds = new Set(manifest.resources.map((resource) => resource.id));
  const refs: unknown[] = [];
  for (const resource of manifest.resources) {
    const { properties } = resource;
    if (resource.type === 'Stripe::Price') {
      refs.push(properties.product, (properties.recurring as { meter?: unknown } | undefined)?.meter);
    }
    if (resource.type === 'Stripe::Product' && Array.isArray(properties.features)) refs.push(...properties.features);
  }
  return new Set(refs.filter((ref): ref is string => typeof ref === 'string' && !logicalIds.has(ref)));
}

function removalItems(
  stackId: string,
  type: string,
  lock: LockFile,
  observations: Observations,
  referenced: Set<string>,
  settled: Set<string>,
): PlanItem[] {
  const items: PlanItem[] = [];
  for (const key of removingKeys(lock, stackId, type)) {
    if (removedObjectIds(type, key, observations).some((id) => referenced.has(id))) continue;
    const steps = removalSteps(type, key, observations, settled, stackId);
    if (steps.length > 0) items.push({ id: key, path: key, type, operation: 'remove', steps });
  }
  return items;
}

/** The Stripe IDs of the objects a removed key stands for, as far as other resources can refer to them. */
function removedObjectIds(type: string, key: string, observations: Observations): string[] {
  const { removed } = observations;
  switch (type) {
    case 'Stripe::Product': {
      const found = removed.products.get(key);
      return found ? [found.product.id] : [];
    }
    case 'Stripe::EntitlementFeature': {
      const feature = removed.features.get(key);
      return feature ? [feature.id] : [];
    }
    case 'Stripe::BillingMeter':
      return observations.activeMeters.filter((meter) => meter.event_name === key).map((meter) => meter.id);
    default:
      return [];
  }
}

function removalSteps(type: string, key: string, observations: Observations, settled: Set<string>, stackId: string): Step[] {
  const ours = (metadata: Record<string, string> | null | undefined) => metadata?.pricectl_stack === stackId;
  const { removed } = observations;
  switch (type) {
    case 'Stripe::Price': {
      const slot = removed.prices.get(key);
      // A product whose default price the plan already settles is left alone: unsetting it here would undo that
      const defaults = Object.fromEntries(Object.entries(slot?.defaultPriceIds ?? {}).map(([product, price]) => [product, settled.has(product) ? null : price]));
      return slot ? planPriceRemoval(slot.versions, defaults) : [];
    }
    case 'Stripe::Coupon':
      return planCouponRemoval(ours(removed.coupons.get(key)?.metadata) ? removed.coupons.get(key) : undefined);
    case 'Stripe::Product': {
      const found = removed.products.get(key);
      return found && ours(found.product.metadata) ? planProductRemoval(found.product, found.hasPrices) : [];
    }
    case 'Stripe::EntitlementFeature':
      return planFeatureRemoval(ours(removed.features.get(key)?.metadata) ? removed.features.get(key) : undefined);
    case 'Stripe::BillingMeter':
      return planMeterRemoval(key, observations.activeMeters);
    default:
      return [];
  }
}
