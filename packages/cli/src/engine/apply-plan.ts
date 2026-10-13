import type Stripe from 'stripe';
import { Operation, Plan, PlanItem, refusals, Step } from './plan';

/** What happened to one plan item. */
export interface AppliedItem {
  id: string;
  path: string;
  type: string;
  operation: Operation;
  /** Stripe ID of the object, once it exists */
  physicalId?: string;
  error?: string;
}

export interface ApplyResult {
  stackId: string;
  items: AppliedItem[];
  /** Whether removing resources was skipped because a defined resource failed */
  removalSkipped: boolean;
}

/** IDs of the objects the plan created or found, by logical ID, so later steps can refer to them. */
type KnownIds = Map<string, string>;

/**
 * Take the steps of a plan, in order. The plan has to be free of refusals: deploy changes
 * nothing when Stripe would reject a step. A step that fails ends its item, not the plan, but
 * nothing is removed after an error (the failed resource may be the replacement of a removed one).
 * What is left undone is picked up by the next plan.
 */
export async function applyPlan(stripe: Stripe, plan: Plan): Promise<ApplyResult> {
  const problems = refusals(plan);
  if (problems.length > 0) {
    throw new Error(`The plan cannot be applied:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  const ids: KnownIds = new Map();
  for (const item of plan.items) {
    if (item.physicalId && item.operation !== 'remove') ids.set(item.id, item.physicalId);
  }

  const result: ApplyResult = { stackId: plan.stackId, items: [], removalSkipped: false };
  let failed = false;
  for (const item of plan.items) {
    if (item.operation === 'remove' && failed) {
      result.removalSkipped = result.removalSkipped || item.steps.length > 0;
      continue;
    }
    const applied = await applyItem(stripe, item, ids);
    if (applied.error) failed = true;
    result.items.push(applied);
  }
  return result;
}

async function applyItem(stripe: Stripe, item: PlanItem, ids: KnownIds): Promise<AppliedItem> {
  const applied: AppliedItem = { id: item.id, path: item.path, type: item.type, operation: item.operation, physicalId: item.physicalId };
  let createdPriceId: string | undefined;
  try {
    for (const step of item.steps) {
      const created = await applyStep(stripe, step, ids, createdPriceId);
      if (created) {
        applied.physicalId = created;
        if (step.kind === 'create') createdPriceId = created;
      }
    }
    if (applied.physicalId && item.operation !== 'remove') ids.set(item.id, applied.physicalId);
  } catch (error: unknown) {
    applied.error = error instanceof Error ? error.message : String(error);
  }
  return applied;
}

/** Take one step. Returns the ID of the object the step created, if it created one. */
async function applyStep(stripe: Stripe, step: Step, ids: KnownIds, createdPriceId: string | undefined): Promise<string | undefined> {
  switch (step.kind) {
    case 'createProduct':
      return (await stripe.products.create(step.params)).id;
    case 'updateProduct':
      await stripe.products.update(step.productId, step.changes);
      return undefined;
    case 'attachFeature':
      await stripe.products.createFeature(step.productId, { entitlement_feature: ids.get(step.featureId) ?? step.featureId });
      return undefined;
    case 'detachFeature':
      await stripe.products.deleteFeature(step.productId, step.productFeatureId);
      return undefined;
    case 'deleteProduct':
      await stripe.products.del(step.productId);
      return undefined;
    case 'archiveProduct':
      await stripe.products.update(step.productId, { active: false });
      return undefined;

    case 'createCoupon':
      return (await stripe.coupons.create(step.params)).id;
    case 'updateCoupon':
      await stripe.coupons.update(step.couponId, step.changes);
      return undefined;
    case 'deleteCoupon':
      await stripe.coupons.del(step.couponId);
      return undefined;

    case 'createFeature':
      return (await stripe.entitlements.features.create(step.params)).id;
    case 'updateFeature':
      await stripe.entitlements.features.update(step.featureId, step.changes);
      return undefined;
    case 'deactivateFeature':
      await stripe.entitlements.features.update(step.featureId, { active: false });
      return undefined;

    case 'createMeter':
      return (await stripe.billing.meters.create(step.params)).id;
    case 'updateMeter':
      await stripe.billing.meters.update(step.meterId, { display_name: step.displayName });
      return undefined;
    case 'deactivateMeter':
      await stripe.billing.meters.deactivate(step.meterId);
      return undefined;

    case 'create':
      return (await stripe.prices.create(withResolvedMeter(step.params, ids))).id;
    case 'update':
      await stripe.prices.update(step.priceId, step.changes);
      return undefined;
    case 'archive':
      await stripe.prices.update(step.priceId, { active: false });
      return undefined;
    case 'setDefault':
      await stripe.products.update(step.productId, { default_price: step.priceId ?? requireCreated(createdPriceId) });
      return undefined;
    case 'unsetDefault':
      await stripe.products.update(step.productId, { default_price: '' });
      return undefined;
  }
}

/** A metered price refers to its meter by logical ID until the meter exists. */
function withResolvedMeter(params: Stripe.PriceCreateParams, ids: KnownIds): Stripe.PriceCreateParams {
  const meter = params.recurring?.meter;
  if (!params.recurring || !meter || !ids.has(meter)) return params;
  return { ...params, recurring: { ...params.recurring, meter: ids.get(meter) } };
}

function requireCreated(priceId: string | undefined): string {
  if (!priceId) throw new Error('The plan sets the default price to a price it did not create.');
  return priceId;
}
