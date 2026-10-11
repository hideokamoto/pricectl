import chalk from 'chalk';
import type { ResourceManifest, StackManifest } from '@pricectl/core';

/**
 * Lines that `deploy --dry-run` prints to describe what a deploy would do: the defined
 * resources, and the resources a deploy would remove because they are no longer defined.
 */
export function describeDeployPlan(manifest: StackManifest, removals: ResourceManifest[] = []): string[] {
  const lines: string[] = [];
  lines.push(chalk.bold.cyan('Dry run — no changes will be made to Stripe'));
  lines.push('');
  lines.push(`Stack: ${chalk.bold(manifest.stackId)}`);
  if (manifest.description) lines.push(`Description: ${manifest.description}`);
  lines.push('');
  lines.push(chalk.bold(`Resources to deploy (${manifest.resources.length}):`));
  for (const resource of manifest.resources) {
    lines.push(chalk.green(`  + ${resource.path} [${resource.type}]`));
    lines.push('    Properties:');
    for (const line of JSON.stringify(resource.properties, null, 2).split('\n')) {
      lines.push(`    ${line}`);
    }
  }
  if (removals.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Resources to remove, no longer defined (${removals.length}):`));
    for (const resource of removals) {
      lines.push(chalk.red(`  - ${resource.path} [${resource.type}]`));
    }
  }
  lines.push('');
  lines.push(chalk.bold('Summary:'));
  lines.push(`  Total: ${chalk.green(manifest.resources.length)} resource(s) would be created/updated`);
  if (removals.length > 0) {
    lines.push(
      `  Removed: ${chalk.red(removals.length)} resource(s) would be removed (confirmation required unless --force)`,
    );
  }
  return lines;
}
