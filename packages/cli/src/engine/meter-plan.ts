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

export interface MeterPlan {
  steps: MeterStep[];
  /** Why no step may be taken, when the plan has to be refused */
  refusal?: string;
}

/** The fields the definition sets that differ from the meter's, which Stripe cannot change. */
function immutableDifferences(params: Stripe.Billing.MeterCreateParams, meter: Stripe.Billing.Meter): string[] {
  const differences: string[] = [];
  if (meter.default_aggregation.formula !== params.default_aggregation.formula) differences.push('default_aggregation');
  if (
    params.customer_mapping &&
    (meter.customer_mapping.event_payload_key !== params.customer_mapping.event_payload_key ||
      meter.customer_mapping.type !== (params.customer_mapping.type ?? 'by_id'))
  ) {
    differences.push('customer_mapping');
  }
  if (params.event_time_window !== undefined && (meter.event_time_window ?? null) !== params.event_time_window) {
    differences.push('event_time_window');
  }
  if (params.value_settings && meter.value_settings.event_payload_key !== params.value_settings.event_payload_key) {
    differences.push('value_settings');
  }
  return differences;
}

/**
 * The steps that bring a meter in line with its definition. The active meter with the event
 * name is used even when it was created outside pricectl (the lock claims the event name).
 * Its display name is the only field Stripe lets you change, so a difference in another field
 * the definition sets is refused rather than ignored. Fields the definition leaves unset keep
 * Stripe's defaults.
 */
export function planMeter(params: Stripe.Billing.MeterCreateParams, activeMeters: Stripe.Billing.Meter[]): MeterPlan {
  const existing = activeMeterFor(params.event_name, activeMeters);
  if (!existing) return { steps: [{ kind: 'createMeter', params }] };

  const differences = immutableDifferences(params, existing);
  if (differences.length > 0) {
    return {
      steps: [],
      refusal: `Meter ${existing.id} cannot be updated: Stripe does not allow changing ${differences.join(', ')}.`,
    };
  }
  if (existing.display_name !== params.display_name) {
    return { steps: [{ kind: 'updateMeter', meterId: existing.id, displayName: params.display_name }] };
  }
  return { steps: [] };
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
