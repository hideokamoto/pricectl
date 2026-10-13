import type Stripe from 'stripe';
import { planMeter, planMeterRemoval } from '../engine/meter-plan';
import meterFixture from './fixtures/stripe/meter.json';

const meter = (overrides: Record<string, unknown> = {}) => ({ ...meterFixture, ...overrides }) as unknown as Stripe.Billing.Meter;

const params: Stripe.Billing.MeterCreateParams = {
  display_name: meterFixture.display_name,
  event_name: meterFixture.event_name,
  default_aggregation: { formula: 'count' },
};

describe('planMeter', () => {
  it('creates the meter when no active meter has the event name', () => {
    const others = [meter({ id: 'mtr_other', event_name: 'other_event' })];

    expect(planMeter(params, others).steps).toEqual([{ kind: 'createMeter', params }]);
  });

  it('creates a meter when none exist', () => {
    expect(planMeter(params, []).steps).toEqual([{ kind: 'createMeter', params }]);
  });

  it('does nothing when the active meter with the event name matches', () => {
    expect(planMeter(params, [meter()]).steps).toEqual([]);
  });

  it('updates the display name of the active meter in place', () => {
    const { steps } = planMeter({ ...params, display_name: 'Renamed' }, [meter()]);

    expect(steps).toEqual([{ kind: 'updateMeter', meterId: meterFixture.id, displayName: 'Renamed' }]);
  });

  it('uses the active meter even when it was created outside pricectl', () => {
    // Stripe allows one active meter per event name, so the one found is the only candidate
    expect(planMeter(params, [meter({ id: 'mtr_dashboard' })]).steps).toEqual([]);
  });
});

describe('planMeter: fields Stripe cannot change', () => {
  it('refuses a different aggregation formula and names it', () => {
    const plan = planMeter({ ...params, default_aggregation: { formula: 'sum' } }, [meter()]);

    expect(plan.steps).toEqual([]);
    expect(plan.refusal).toContain('default_aggregation');
    expect(plan.refusal).toContain(meterFixture.id);
  });

  it('refuses a different value key, customer key or time window when the definition sets one', () => {
    const plan = planMeter(
      {
        ...params,
        customer_mapping: { event_payload_key: 'other', type: 'by_id' },
        value_settings: { event_payload_key: 'amount' },
        event_time_window: 'hour',
      },
      [meter()],
    );

    expect(plan.refusal).toContain('customer_mapping');
    expect(plan.refusal).toContain('value_settings');
    expect(plan.refusal).toContain('event_time_window');
  });

  it('leaves fields alone that the definition does not set (Stripe fills in its defaults)', () => {
    expect(planMeter(params, [meter()]).refusal).toBeUndefined();
  });

  it('accepts the same optional fields as the meter has', () => {
    const same = {
      ...params,
      customer_mapping: { event_payload_key: 'stripe_customer_id', type: 'by_id' as const },
      value_settings: { event_payload_key: 'value' },
    };

    expect(planMeter(same, [meter()])).toEqual({ steps: [] });
  });
});

describe('planMeterRemoval', () => {
  it('deactivates the active meter with the event name', () => {
    expect(planMeterRemoval(meterFixture.event_name, [meter()])).toEqual([
      { kind: 'deactivateMeter', meterId: meterFixture.id },
    ]);
  });

  it('does nothing when no active meter has the event name', () => {
    expect(planMeterRemoval(meterFixture.event_name, [meter({ event_name: 'other_event' })])).toEqual([]);
  });
});
