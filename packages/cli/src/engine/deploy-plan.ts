import chalk from 'chalk';
import type { StackManifest } from '@pricectl/core';

/** Lines that `deploy --dry-run` prints to describe what a deploy would do. */
export function describeDeployPlan(manifest: StackManifest): string[] {
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
  lines.push('');
  lines.push(chalk.bold('Summary:'));
  lines.push(`  Total: ${chalk.green(manifest.resources.length)} resource(s) would be created/updated`);
  return lines;
}
