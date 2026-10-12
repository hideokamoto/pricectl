import type { ApplyResult } from './apply-plan';

/** How a deploy or destroy run ends: the headline shown to the user and whether the command fails. */
export interface RunOutcome {
  headline: string;
  failed: boolean;
}

function hasErrors(result: ApplyResult): boolean {
  return result.items.some((item) => item.error !== undefined);
}

/** Decide how a deploy run ends. Any resource error fails the run. */
export function deployOutcome(result: ApplyResult): RunOutcome {
  return hasErrors(result)
    ? { headline: '✗ Deployment finished with errors', failed: true }
    : { headline: '✓ Deployment completed', failed: false };
}

/** Decide how a destroy run ends. Any resource error fails the run. */
export function destroyOutcome(result: ApplyResult): RunOutcome {
  return hasErrors(result)
    ? { headline: '✗ Destruction finished with errors', failed: true }
    : { headline: '✓ Destruction completed', failed: false };
}
