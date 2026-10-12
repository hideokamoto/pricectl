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

    expect(planMeter(params, others)).toEqual([{ kind: 'createMeter', params }]);
  });

  it('creates a meter when none exist', () => {
    expect(planMeter(params, [])).toEqual([{ kind: 'createMeter', params }]);
  });

  it('does nothing when the active meter with the event name matches', () => {
    expect(planMeter(params, [meter()])).toEqual([]);
  });

  it('updates the display name of the active meter in place', () => {
    const steps = planMeter({ ...params, display_name: 'Renamed' }, [meter()]);

    expect(steps).toEqual([{ kind: 'updateMeter', meterId: meterFixture.id, displayName: 'Renamed' }]);
  });

  it('uses the active meter even when it was created outside pricectl', () => {
    // Stripe allows one active meter per event name, so the one found is the only candidate
    expect(planMeter(params, [meter({ id: 'mtr_dashboard' })])).toEqual([]);
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
