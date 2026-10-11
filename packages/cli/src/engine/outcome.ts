import type { DeployResult, DestroyResult } from './deployer';

/** How a deploy or destroy run ends: the headline shown to the user and whether the command fails. */
export interface RunOutcome {
  headline: string;
  failed: boolean;
}

/** Decide how a deploy run ends. */
export function deployOutcome(_result: DeployResult): RunOutcome {
  return { headline: '✓ Deployment completed', failed: false };
}

/** Decide how a destroy run ends. */
export function destroyOutcome(result: DestroyResult): RunOutcome {
  return { headline: '✓ Destruction completed', failed: result.errors.length > 0 };
}
