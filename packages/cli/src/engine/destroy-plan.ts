import chalk from 'chalk';
import type { DestroyPlan } from './deployer';

/** What destroy does to a resource, as the verb shown next to it. */
const ACTION = { deleted: 'delete', deactivated: 'deactivate' } as const;

/**
 * Lines that `destroy` prints before it changes anything: what it would do to each resource
 * that still exists and is active in Stripe, and the resources whose state could not be read.
 */
export function describeDestroyPlan(plan: DestroyPlan): string[] {
  const lines: string[] = [];
  if (plan.resources.length > 0) {
    lines.push('The following resources will be deleted or deactivated:');
    for (const resource of plan.resources) {
      lines.push(chalk.red(`  - ${resource.path} [${resource.type}] (${ACTION[resource.status]})`));
    }
  } else if (plan.errors.length === 0) {
    lines.push(`Nothing to destroy: every resource of stack ${plan.stackId} is already deleted or inactive in Stripe.`);
  }
  if (plan.errors.length > 0) {
    lines.push(chalk.bold.red('Could not read the current state of these resources in Stripe:'));
    for (const error of plan.errors) {
      lines.push(`  ${chalk.red('✗')} ${error.id} [${error.type}]: ${error.error}`);
    }
  }
  return lines;
}
