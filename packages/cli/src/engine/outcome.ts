import type { DeployResult, DestroyResult } from './deployer';

/** How a deploy or destroy run ends: the headline shown to the user and whether the command fails. */
export interface RunOutcome {
  headline: string;
  failed: boolean;
}

/** Decide how a deploy run ends. Any resource error fails the run. */
export function deployOutcome(result: DeployResult): RunOutcome {
  return result.errors.length > 0
    ? { headline: '✗ Deployment finished with errors', failed: true }
    : { headline: '✓ Deployment completed', failed: false };
}

/** Decide how a destroy run ends. Any resource error fails the run. */
export function destroyOutcome(result: DestroyResult): RunOutcome {
  return result.errors.length > 0
    ? { headline: '✗ Destruction finished with errors', failed: true }
    : { headline: '✓ Destruction completed', failed: false };
}
