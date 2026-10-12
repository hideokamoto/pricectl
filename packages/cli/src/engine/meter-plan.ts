import type Stripe from 'stripe';

/** One change to Stripe for a billing meter. Steps refer to the meter by the ID plan saw. */
export type MeterStep =
  | { kind: 'createMeter'; params: Stripe.Billing.MeterCreateParams }
  | { kind: 'updateMeter'; meterId: string; displayName: string }
  | { kind: 'deactivateMeter'; meterId: string };

/**
 * Billing meters cannot be looked up by event name, so plan reads the active meters. Stripe
 * allows one active meter per event name, which makes the match exact. A deactivated meter
 * is never looked at: Stripe lets a new meter take its event name.
 */
function activeMeterFor(eventName: string, activeMeters: Stripe.Billing.Meter[]): Stripe.Billing.Meter | undefined {
  return activeMeters.find((meter) => meter.event_name === eventName && meter.status === 'active');
}

/**
 * The steps that bring a meter in line with its definition. The active meter with the event
 * name is used even when it was created outside pricectl (the lock claims the event name);
 * its display name is the only field Stripe lets you change.
 */
export function planMeter(params: Stripe.Billing.MeterCreateParams, activeMeters: Stripe.Billing.Meter[]): MeterStep[] {
  const existing = activeMeterFor(params.event_name, activeMeters);
  if (!existing) return [{ kind: 'createMeter', params }];
  if (existing.display_name !== params.display_name) {
    return [{ kind: 'updateMeter', meterId: existing.id, displayName: params.display_name }];
  }
  return [];
}

/**
 * The steps that remove the meter of an event name the lock marks as removing: deactivate the
 * active meter plan found. A meter created after the plan is never touched, because the step
 * names the meter by ID.
 */
export function planMeterRemoval(eventName: string, activeMeters: Stripe.Billing.Meter[]): MeterStep[] {
  const existing = activeMeterFor(eventName, activeMeters);
  return existing ? [{ kind: 'deactivateMeter', meterId: existing.id }] : [];
}
