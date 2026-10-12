import type Stripe from 'stripe';
import type { ResourceManifest, StackManifest } from '@pricectl/core';
import { planCoupon, planCouponRemoval } from './coupon-plan';
import { planFeature, planFeatureRemoval } from './feature-plan';
import type { LockFile } from './lock';
import { planMeter, planMeterRemoval } from './meter-plan';
import { operationOf, Plan, PlanItem, Step } from './plan';
import { planPrice, planPriceRemoval } from './price-plan';
import { planProduct, planProductRemoval, ProductObservation } from './product-plan';
import { indexResources, priceLookupKeyOf, resolveProductRef } from './refs';
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
  const defined = [...manifest.resources].sort((a, b) => APPLY_ORDER.indexOf(a.type) - APPLY_ORDER.indexOf(b.type));
  const items = defined.map((resource) => planResource(manifest.stackId, resource, resources, observations));

  const removed = REMOVAL_ORDER.flatMap((type) => removalItems(manifest.stackId, type, lock, observations));
  return { stackId: manifest.stackId, items: [...items, ...removed] };
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
  if (resource.physicalId && existing && existing.lookup_key !== params.lookup_key) {
    return item(resource, [], {
      physicalId: existing.id,
      refusal:
        `Feature ${existing.id} has lookup_key "${existing.lookup_key}", but "${resource.id}" defines "${params.lookup_key}"; ` +
        'Stripe does not allow changing lookup_key.',
    });
  }
  const plan = planFeature(stackId, { logicalId: resource.id, key: params.lookup_key, params }, existing);
  return item(resource, plan.steps, { physicalId: existing?.id, refusal: plan.refusal });
}

/** A feature reference in a product: a feature of the definition becomes its Stripe ID when it exists, otherwise it stays a logical ID until applied. */
function resolveFeatureRef(ref: string, resources: Map<string, ResourceManifest>, observations: Observations): string {
  const target = resources.get(ref);
  if (target?.type !== 'Stripe::EntitlementFeature') return ref;
  return observations.features.get(target.id)?.id ?? target.physicalId ?? ref;
}

function planProductResource(
  stackId: string,
  resource: ResourceManifest,
  resources: Map<string, ResourceManifest>,
  observations: Observations,
): PlanItem {
  const { features, ...params } = resource.properties;
  const observation: ProductObservation = observations.products.get(resource.id) ?? { attachedFeatures: new Map() };
  const desiredFeatureIds = (features as string[] | undefined)?.map((ref) => resolveFeatureRef(ref, resources, observations));
  const steps = planProduct(
    stackId,
    { logicalId: resource.id, key: resource.key, params: params as unknown as Stripe.ProductCreateParams, desiredFeatureIds },
    observation,
  );
  return item(resource, steps, { physicalId: observation.product?.id });
}

function planCouponResource(stackId: string, resource: ResourceManifest, observations: Observations): PlanItem {
  const existing = observations.coupons.get(resource.id);
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
    const meter = resources.get(meterRef);
    const existing = meter && (observations.adoptedMeters.get(meter.id) ?? observations.activeMeters.find((m) => m.event_name === meter.properties.event_name));
    params.recurring = { ...params.recurring, meter: existing?.id ?? meter?.physicalId ?? meterRef };
  }
  const observation = observations.prices.get(resource.id) ?? { versions: [], defaultPriceIds: {} };
  const plan = planPrice(
    stackId,
    { logicalId: resource.id, key: priceLookupKeyOf(resource), isDefault: Boolean(resource.isDefault), params },
    observation,
  );
  return item(resource, plan.steps, { physicalId: observation.holder?.id, refusal: plan.refusal });
}

function removalItems(stackId: string, type: string, lock: LockFile, observations: Observations): PlanItem[] {
  const items: PlanItem[] = [];
  for (const key of removingKeys(lock, stackId, type)) {
    const steps = removalSteps(type, key, observations);
    if (steps.length > 0) items.push({ id: key, path: key, type, operation: 'remove', steps });
  }
  return items;
}

function removalSteps(type: string, key: string, observations: Observations): Step[] {
  const { removed } = observations;
  switch (type) {
    case 'Stripe::Price': {
      const slot = removed.prices.get(key);
      return slot ? planPriceRemoval(slot.versions, slot.defaultPriceIds) : [];
    }
    case 'Stripe::Coupon':
      return planCouponRemoval(removed.coupons.get(key));
    case 'Stripe::Product': {
      const found = removed.products.get(key);
      return found ? planProductRemoval(found.product, found.hasPrices) : [];
    }
    case 'Stripe::EntitlementFeature':
      return planFeatureRemoval(removed.features.get(key));
    case 'Stripe::BillingMeter':
      return planMeterRemoval(key, observations.activeMeters);
    default:
      return [];
  }
}
