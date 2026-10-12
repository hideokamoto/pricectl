import type { ResourceManifest, StackManifest } from '@pricectl/core';

/** `managed`: the definition claims the key. `removing`: it no longer does, and a person has not released it yet. */
export type LockEntry = 'managed' | 'removing';

/** The keys a stack claims, by resource type. */
export type StackLock = Record<string, Record<string, LockEntry>>;

/**
 * `pricectl.lock.json`: the keys each stack claims in Stripe, committed to Git. It holds what
 * Stripe cannot record itself, so a resource that left the definition is still found and removed.
 * It depends only on the definition and the previous lock, never on Stripe.
 */
export interface LockFile {
  version: number;
  stacks: Record<string, StackLock>;
}

export const LOCK_FILE_NAME = 'pricectl.lock.json';
const LOCK_VERSION = 1;

/** A lock that claims nothing. */
export function emptyLock(): LockFile {
  return { version: LOCK_VERSION, stacks: {} };
}

/**
 * The name Stripe knows a resource by: a billing meter's event name, a price's lookup key
 * (the definition's own, or the derived one), a feature's lookup key, and the derived ID of
 * products and coupons. Undefined for a resource that points at an existing Stripe object.
 */
function claimedKey(resource: ResourceManifest): string | undefined {
  if (resource.physicalId) return undefined;
  const { properties } = resource;
  switch (resource.type) {
    case 'Stripe::BillingMeter':
      return stringOrUndefined(properties.event_name);
    case 'Stripe::Price':
      return stringOrUndefined(properties.lookup_key) ?? resource.key;
    case 'Stripe::EntitlementFeature':
      return stringOrUndefined(properties.lookup_key);
    default:
      return resource.key;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The lock after a definition change: every defined key is `managed`, and every key that was
 * claimed before and is no longer defined is `removing`. Entries are never dropped here; a
 * person drops a `removing` entry by editing the lock, which releases the key.
 */
export function nextLock(manifest: StackManifest, previous: LockFile): LockFile {
  const defined: StackLock = {};
  for (const resource of manifest.resources) {
    const key = claimedKey(resource);
    if (key === undefined) continue;
    defined[resource.type] = { ...defined[resource.type], [key]: 'managed' };
  }

  const before = previous.stacks[manifest.stackId] ?? {};
  const stack: StackLock = {};
  for (const type of new Set([...Object.keys(before), ...Object.keys(defined)])) {
    const entries: Record<string, LockEntry> = {};
    for (const key of Object.keys(before[type] ?? {})) entries[key] = 'removing';
    Object.assign(entries, defined[type]);
    stack[type] = entries;
  }

  const stacks = { ...previous.stacks };
  if (Object.keys(stack).length > 0) {
    stacks[manifest.stackId] = stack;
  } else {
    delete stacks[manifest.stackId];
  }
  return { version: LOCK_VERSION, stacks };
}

/**
 * For CI (`--frozen-lock`): a message telling the user how to fix a lock that is not what the
 * definition implies, or undefined when it is up to date. CI never writes the lock back.
 */
export function checkFrozenLock(manifest: StackManifest, current: LockFile): string | undefined {
  const expected = serializeLock(nextLock(manifest, current));
  return expected === serializeLock(current)
    ? undefined
    : `${LOCK_FILE_NAME} is out of date for stack "${manifest.stackId}". ` +
        `Run "pricectl synth" and commit ${LOCK_FILE_NAME}.`;
}

/** The lock as JSON with sorted keys and a final newline, so that it changes only when the claims do. */
export function serializeLock(lock: LockFile): string {
  return JSON.stringify(sortKeys(lock), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, sortKeys(object[key])]),
  );
}

/**
 * Read a lock. A missing lock is an empty one; an unreadable one is an error, because
 * treating it as empty would forget the keys waiting for removal.
 */
export function parseLock(contents: string | undefined): LockFile {
  if (contents === undefined) return emptyLock();
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`${LOCK_FILE_NAME} is not valid JSON. Fix it or restore it from Git.`);
  }
  const lock = parsed as Partial<LockFile> | null;
  if (lock?.version !== LOCK_VERSION) {
    throw new Error(`${LOCK_FILE_NAME} has version ${String(lock?.version)}; this pricectl reads version ${LOCK_VERSION}.`);
  }
  if (typeof lock.stacks !== 'object' || lock.stacks === null || Array.isArray(lock.stacks)) {
    throw new Error(`${LOCK_FILE_NAME} has no "stacks" object.`);
  }
  return lock as LockFile;
}
