import { normalizeResource } from './stripe-utils';

type StripeResource = Parameters<typeof normalizeResource>[0];

/** Comparison of one resource's desired properties with its current state in Stripe. */
export interface ResourceDiff {
  changed: boolean;
  /** Current state, as pretty-printed JSON for display. */
  current: string;
  /** Desired state, as pretty-printed JSON for display. */
  desired: string;
}

/** Compare desired construct properties with the resource currently in Stripe. */
export function diffResource(
  type: string,
  desiredProperties: Record<string, unknown>,
  current: StripeResource,
): ResourceDiff {
  const desired = JSON.stringify(desiredProperties, null, 2);
  const existing = JSON.stringify(normalizeResource(current, type), null, 2);
  return { changed: desired !== existing, current: existing, desired };
}
