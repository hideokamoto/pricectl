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
