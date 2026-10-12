const PRICECTL_PREFIX = 'pricectl_';

/** Whether a metadata key is one pricectl writes itself (`pricectl_stack`, `pricectl_id`, ...). */
export function isPricectlTag(key: string): boolean {
  return key.startsWith(PRICECTL_PREFIX);
}

/** User metadata: everything but pricectl's own tags, with values as Stripe stores them (strings). */
export function userMetadata(
  metadata: Record<string, string | number | null> | '' | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata || {})
      .filter(([key, value]) => !isPricectlTag(key) && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

/** Metadata update that turns `current` into `desired`: removed keys are unset with an empty string. */
export function metadataChanges(current: Record<string, string>, desired: Record<string, string>): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (current[key] !== value) changes[key] = value;
  }
  for (const key of Object.keys(current)) {
    if (!(key in desired)) changes[key] = '';
  }
  return changes;
}

/**
 * The pricectl tags an existing object needs to be recognized as the stack's: nothing when it
 * has them already, otherwise both tags. Objects found by their key may have been created by hand.
 */
export function ownershipTags(
  metadata: Record<string, string> | null | undefined,
  stackId: string,
  logicalId: string,
): Record<string, string> {
  return metadata?.pricectl_stack === stackId ? {} : { pricectl_stack: stackId, pricectl_id: logicalId };
}
