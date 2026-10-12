import chalk from 'chalk';
import { Plan, PlanItem, renameWarnings, Step } from './plan';

/** One line saying what a step does to Stripe. */
export function describeStep(step: Step): string {
  switch (step.kind) {
    case 'createProduct':
      return `create product ${step.params.id}`;
    case 'updateProduct':
      return `update product ${step.productId}: ${Object.keys(step.changes).join(', ')}`;
    case 'attachFeature':
      return `attach feature ${step.featureId} to product ${step.productId}`;
    case 'detachFeature':
      return `detach feature ${step.productFeatureId} from product ${step.productId}`;
    case 'deleteProduct':
      return `delete product ${step.productId}`;
    case 'archiveProduct':
      return `archive product ${step.productId} (it has prices)`;

    case 'createCoupon':
      return `create coupon ${step.params.id}`;
    case 'updateCoupon':
      return `update coupon ${step.couponId}: ${Object.keys(step.changes).join(', ')}`;
    case 'deleteCoupon':
      return `delete coupon ${step.couponId}`;

    case 'createFeature':
      return `create feature "${step.params.lookup_key}"`;
    case 'updateFeature':
      return `update feature ${step.featureId}: ${Object.keys(step.changes).join(', ')}`;
    case 'deactivateFeature':
      return `deactivate feature ${step.featureId}`;

    case 'createMeter':
      return `create meter for event "${step.params.event_name}"`;
    case 'updateMeter':
      return `rename meter ${step.meterId} to "${step.displayName}"`;
    case 'deactivateMeter':
      return `deactivate meter ${step.meterId}`;

    case 'create':
      return (
        `create price with lookup key "${step.params.lookup_key}"` +
        (step.params.transfer_lookup_key ? ', taking the key over from the current price' : '')
      );
    case 'update':
      return `update price ${step.priceId}: ${Object.keys(step.changes).join(', ')}`;
    case 'archive':
      return `archive price ${step.priceId}`;
    case 'setDefault':
      return step.priceId === null
        ? `make the new price the default price of product ${step.productId}`
        : `make price ${step.priceId} the default price of product ${step.productId}`;
    case 'unsetDefault':
      return `unset the default price of product ${step.productId}`;
  }
}

const SYMBOL = { create: chalk.green('+'), update: chalk.yellow('~'), remove: chalk.red('-'), unchanged: ' ' } as const;

function describeItem(item: PlanItem): string[] {
  return [`  ${SYMBOL[item.operation]} ${item.path} [${item.type}]`, ...item.steps.map((step) => `      ${describeStep(step)}`)];
}

/**
 * Lines that `plan` prints, and that `deploy` shows before it changes anything: refusals and
 * warnings first, then each resource that changes with its steps, then a summary.
 */
export function describePlan(plan: Plan): string[] {
  const lines = [`Stack: ${plan.stackId}`, ''];

  const refused = plan.items.filter((item) => item.refusal);
  if (refused.length > 0) {
    lines.push(chalk.bold.red('Refused: nothing will be changed.'));
    for (const item of refused) lines.push(`  ${chalk.red('✗')} ${item.path}: ${item.refusal}`);
    lines.push('');
  }
  for (const warning of renameWarnings(plan)) {
    lines.push(chalk.yellow(`Warning: ${warning}`));
    lines.push('');
  }

  const changed = plan.items.filter((item) => item.operation !== 'unchanged' && !item.refusal);
  for (const item of changed) lines.push(...describeItem(item));
  if (changed.length > 0) lines.push('');

  const count = (operation: PlanItem['operation']) => plan.items.filter((item) => item.operation === operation && !item.refusal).length;
  if (changed.length === 0 && refused.length === 0) {
    lines.push('Nothing to do: Stripe matches the definition.');
  } else if (changed.length > 0) {
    lines.push(
      `Plan: ${count('create')} to create, ${count('update')} to update, ${count('remove')} to remove, ${count('unchanged')} unchanged.` +
        (count('remove') > 0 ? ' Removals need approval (--force skips it).' : ''),
    );
  }
  return lines;
}
