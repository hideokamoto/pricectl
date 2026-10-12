import chalk from 'chalk';
import type { ResourceManifest, StackManifest } from '@pricectl/core';
import type { DeployPlan } from './deployer';

/** How each action is shown next to a resource: marker, color and verb. */
const DISPLAY = {
  create: { marker: '+', color: chalk.green },
  update: { marker: '~', color: chalk.yellow },
  replace: { marker: '~', color: chalk.yellow },
  unchanged: { marker: '=', color: chalk.gray },
} as const;

/**
 * Lines that `deploy --dry-run` prints to describe what a deploy would do: what each defined
 * resource needs given its current state in Stripe, and the resources a deploy would remove
 * because they are no longer defined.
 */
export function describeDeployPlan(manifest: StackManifest, plan: DeployPlan, removals: ResourceManifest[] = []): string[] {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
  lines.push('');
  lines.push(`Stack: ${chalk.bold(manifest.stackId)}`);
  if (manifest.description) lines.push(`Description: ${manifest.description}`);
  lines.push('');
  lines.push(chalk.bold(`Resources (${manifest.resources.length}):`));
  const propertiesById = new Map(manifest.resources.map((r) => [r.id, r.properties]));
  for (const resource of plan.resources) {
    const { marker, color } = DISPLAY[resource.action];
    lines.push(color(`  ${marker} ${resource.path} [${resource.type}] (${resource.action})`));
    if (resource.action === 'unchanged') continue;
    lines.push('    Properties:');
    for (const line of JSON.stringify(propertiesById.get(resource.id), null, 2).split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push(chalk.bold.red('Could not read the current state of these resources in Stripe:'));
    for (const error of plan.errors) {
      lines.push(`  ${chalk.red('✗')} ${error.id} [${error.type}]: ${error.error}`);
    }
  }
  if (removals.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Resources to remove, no longer defined (${removals.length}):`));
    for (const resource of removals) {
      lines.push(chalk.red(`  - ${resource.path} [${resource.type}]`));
    }
  }
  const count = (action: DeployPlan['resources'][number]['action']) =>
    plan.resources.filter((r) => r.action === action).length;
  lines.push('');
  lines.push(chalk.bold('Summary:'));
  lines.push(`  Created: ${chalk.green(count('create'))}`);
  lines.push(`  Updated: ${chalk.yellow(count('update'))}`);
  lines.push(`  Replaced: ${chalk.yellow(count('replace'))}`);
  lines.push(`  Unchanged: ${chalk.gray(count('unchanged'))}`);
  if (removals.length > 0) {
    lines.push(
      `  Removed: ${chalk.red(removals.length)} resource(s) would be removed (confirmation required unless --force)`,
    );
  }
  return lines;
}
