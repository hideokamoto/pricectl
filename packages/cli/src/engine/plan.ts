import type { CouponStep } from './coupon-plan';
import type { FeatureStep } from './feature-plan';
import type { MeterStep } from './meter-plan';
import type { PriceStep } from './price-plan';
import type { ProductStep } from './product-plan';

/** One change to Stripe. Every step names the Stripe objects it touches by the ID plan saw. */
export type Step = ProductStep | PriceStep | CouponStep | FeatureStep | MeterStep;

/** What a plan does to one resource. */
export type Operation = 'create' | 'update' | 'unchanged' | 'remove';

/** The steps for one resource of the definition, or for one key that left the definition. */
export interface PlanItem {
  /** Logical ID of a defined resource; the claimed key of a resource being removed */
  id: string;
  path: string;
  type: string;
  operation: Operation;
  steps: Step[];
  /** Stripe ID of the object this item is about, when it exists already */
  physicalId?: string;
  /** Why the steps may not be taken (Stripe would reject them, or they would lose data) */
  refusal?: string;
}

/** What `deploy` would do to Stripe, worked out before anything is changed. */
export interface Plan {
  stackId: string;
  /** In the order the steps must be taken: dependencies first, removals last */
  items: PlanItem[];
}

/** The operation a list of steps amounts to. */
export function operationOf(steps: Step[]): Exclude<Operation, 'remove'> {
  if (steps.length === 0) return 'unchanged';
  return steps.some((step) => step.kind.startsWith('create')) ? 'create' : 'update';
}

/** The items that make no change and need no attention. */
export function changedItems(plan: Plan): PlanItem[] {
  return plan.items.filter((item) => item.operation !== 'unchanged' || item.refusal);
}

/** The refusals in a plan: when there are any, deploy changes nothing. */
export function refusals(plan: Plan): string[] {
  return plan.items.flatMap((item) => (item.refusal ? [item.refusal] : []));
}

/** The items that remove resources from Stripe, which deploy asks approval for. */
export function removals(plan: Plan): PlanItem[] {
  return plan.items.filter((item) => item.operation === 'remove');
}

/**
 * Warnings for a deploy that looks like a rename: a new resource and a removed resource of one
 * type in the same plan. pricectl cannot tell a rename from a removal plus an addition, and a
 * rename replaces the Stripe object (the logical ID names the resource, the lookup key names a price).
 */
export function renameWarnings(plan: Plan): string[] {
  const warnings: string[] = [];
  for (const type of new Set(plan.items.map((item) => item.type))) {
    const added = plan.items.filter((item) => item.type === type && item.operation === 'create' && !item.physicalId);
    const gone = plan.items.filter((item) => item.type === type && item.operation === 'remove');
    if (added.length === 0 || gone.length === 0) continue;
    warnings.push(
      `${type}: ${list(added.map((item) => item.path))} ${added.length === 1 ? 'is' : 'are'} new and ` +
        `${list(gone.map((item) => item.path))} ${gone.length === 1 ? 'is' : 'are'} removed in the same deploy. ` +
        'If this is a rename, the Stripe object is replaced: logical IDs and lookup keys are permanent.',
    );
  }
  return warnings;
}

function list(paths: string[]): string {
  return paths.map((path) => `"${path}"`).join(', ');
}
