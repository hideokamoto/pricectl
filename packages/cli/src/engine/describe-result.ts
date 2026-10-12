import chalk from 'chalk';
import type { ApplyResult } from './apply-plan';

const VERB = { create: 'created', update: 'updated', remove: 'removed', unchanged: 'unchanged' } as const;

/** Lines that say what an applied plan did, one per changed resource, then the counts. */
export function describeResult(result: ApplyResult): string[] {
  const lines: string[] = [];
  for (const item of result.items) {
    if (item.error) {
      lines.push(`  ${chalk.red('✗')} ${item.path} [${item.type}]: ${item.error}`);
    } else if (item.operation !== 'unchanged') {
      lines.push(`  ${VERB[item.operation]} ${item.path} [${item.type}]${item.operation !== 'remove' && item.physicalId ? ` → ${item.physicalId}` : ''}`);
    }
  }
  if (result.removalSkipped) {
    lines.push('Resources that are no longer defined were not removed because of the errors above.');
  }
  const count = (operation: keyof typeof VERB) => result.items.filter((item) => item.operation === operation && !item.error).length;
  const errors = result.items.filter((item) => item.error).length;
  if (lines.length > 0 && !result.removalSkipped) lines.push('');
  lines.push(`Created: ${count('create')}, updated: ${count('update')}, removed: ${count('remove')}, unchanged: ${count('unchanged')}.`);
  if (errors > 0) lines.push(`Errors: ${errors}.`);
  return lines;
}
