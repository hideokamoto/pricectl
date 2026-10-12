import type Stripe from 'stripe';
import type { StackManifest } from '@pricectl/core';
import type { ApplyResult } from './apply-plan';
import { buildPlan } from './build-plan';
import { emptyLock, nextLock, parseLock, serializeLock } from './lock';
import { LockStore, syncLock } from './lock-store';
import type { Plan } from './plan';

export type PlanDeployResult = { ok: true; plan: Plan; lockChanged: boolean } | { ok: false; message: string };

/**
 * Bring `pricectl.lock.json` in line with the definition, then work out what a deploy would do.
 * With `frozen` (CI) an out-of-date lock is refused before Stripe is read, and the lock is never written.
 */
export async function planDeploy(
  stripe: Stripe,
  manifest: StackManifest,
  store: LockStore,
  options: { frozen: boolean },
): Promise<PlanDeployResult> {
  const synced = syncLock(manifest, store, options);
  if (!synced.ok) return synced;
  const plan = await buildPlan(stripe, manifest, parseLock(store.read()));
  return { ok: true, plan, lockChanged: synced.changed };
}

/** The stack's manifest with nothing defined: every key it claims is removed. */
function withoutResources(manifest: StackManifest): StackManifest {
  return { ...manifest, resources: [] };
}

/**
 * Work out what destroying the stack would do: remove every key the lock claims for it and every
 * key the definition defines (the lock may not list a resource that was deployed from a machine
 * that did not commit it). The lock is not written yet; `finishDestroy` does that once the plan
 * has been applied.
 */
export async function planDestroy(stripe: Stripe, manifest: StackManifest, store: LockStore): Promise<Plan> {
  const claimed = nextLock(manifest, parseLock(store.read()));
  const empty = withoutResources(manifest);
  return buildPlan(stripe, empty, nextLock(empty, claimed));
}

/**
 * Record the outcome of a destroy in the lock. When everything was removed the stack has nothing
 * left to claim, so its entries go (a person ran destroy, which is what releasing a key means).
 * Otherwise every key stays `removing`, so the next destroy or deploy finishes the job.
 */
export function finishDestroy(store: LockStore, stackId: string, result: ApplyResult): void {
  const current = parseLock(store.read());
  const failed = result.removalSkipped || result.items.some((item) => item.error);
  const next = failed ? nextLock({ stackId, tags: {}, resources: [] }, current) : forget(current, stackId);
  if (serializeLock(next) !== serializeLock(current) || store.read() === undefined) store.write(serializeLock(next));
}

function forget(lock: ReturnType<typeof emptyLock>, stackId: string): ReturnType<typeof emptyLock> {
  const stacks = { ...lock.stacks };
  delete stacks[stackId];
  return { ...lock, stacks };
}
