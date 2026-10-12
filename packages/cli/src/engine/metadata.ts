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
