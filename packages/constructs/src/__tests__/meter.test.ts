import { Meter } from '../meter';
import { createStack } from './helpers';

describe('Meter', () => {

  describe('プロパティの設定', () => {
    it('必須プロパティのみで生成できる', () => {
      const stack = createStack();
      const meter = new Meter(stack, 'ApiCalls', {
        displayName: 'API Calls',
        eventName: 'api_call',
        defaultAggregation: { formula: 'count' },
      });

      expect(meter.displayName).toBe('API Calls');
      expect(meter.eventName).toBe('api_call');
      expect(meter.defaultAggregation).toEqual({ formula: 'count' });
    });

    it('sumアグリゲーションを設定できる', () => {
      const stack = createStack();
      const meter = new Meter(stack, 'DataUsage', {
        displayName: 'Data Usage',
        eventName: 'data_transfer',
        defaultAggregation: { formula: 'sum' },
      });

      expect(meter.defaultAggregation.formula).toBe('sum');
    });

    it('すべてのオプショナルプロパティを設定できる', () => {
      const stack = createStack();
      const meter = new Meter(stack, 'FullMeter', {
        displayName: 'Full Meter',
        eventName: 'full_event',
        defaultAggregation: { formula: 'sum' },
        customerMapping: {
          eventPayloadKey: 'stripe_customer_id',
          type: 'by_id',
        },
        eventTimeWindow: 'hour',
        valueSettings: {
          eventPayloadKey: 'bytes_used',
        },
      });

      expect(meter.customerMapping).toEqual({
        eventPayloadKey: 'stripe_customer_id',
        type: 'by_id',
      });
      expect(meter.eventTimeWindow).toBe('hour');
      expect(meter.valueSettings).toEqual({ eventPayloadKey: 'bytes_used' });
    });
  });

  describe('synthesizeProperties（synth経由）', () => {
    it('必須プロパティのみの場合', () => {
      const stack = createStack();
      new Meter(stack, 'Meter1', {
        displayName: 'Request Count',
        eventName: 'request',
        defaultAggregation: { formula: 'count' },
      });

      const manifest = stack.synth();

      expect(manifest.resources).toHaveLength(1);
      expect(manifest.resources[0].type).toBe('Stripe::BillingMeter');
      expect(manifest.resources[0].properties).toEqual({
        display_name: 'Request Count',
        event_name: 'request',
        default_aggregation: { formula: 'count' },
      });
    });

    it('customerMappingがsnake_caseに変換される', () => {
      const stack = createStack();
      new Meter(stack, 'Meter2', {
        displayName: 'Meter',
        eventName: 'event',
        defaultAggregation: { formula: 'count' },
        customerMapping: {
          eventPayloadKey: 'customer_id',
        },
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.customer_mapping).toEqual({
        event_payload_key: 'customer_id',
        type: 'by_id',
      });
    });

    it('eventTimeWindowがsnake_caseに変換される', () => {
      const stack = createStack();
      new Meter(stack, 'Meter3', {
        displayName: 'Meter',
        eventName: 'event',
        defaultAggregation: { formula: 'count' },
        eventTimeWindow: 'day',
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.event_time_window).toBe('day');
    });

    it('valueSettingsがsnake_caseに変換される', () => {
      const stack = createStack();
      new Meter(stack, 'Meter4', {
        displayName: 'Meter',
        eventName: 'event',
        defaultAggregation: { formula: 'sum' },
        valueSettings: { eventPayloadKey: 'amount' },
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props.value_settings).toEqual({
        event_payload_key: 'amount',
      });
    });

    it('未指定のオプショナルプロパティはpropertiesに含まれない', () => {
      const stack = createStack();
      new Meter(stack, 'Minimal', {
        displayName: 'Minimal',
        eventName: 'event',
        defaultAggregation: { formula: 'count' },
      });

      const manifest = stack.synth();
      const props = manifest.resources[0].properties;

      expect(props).not.toHaveProperty('customer_mapping');
      expect(props).not.toHaveProperty('event_time_window');
      expect(props).not.toHaveProperty('value_settings');
    });
  });

  describe('resourceType', () => {
    it('Stripe::BillingMeterを返す', () => {
      const stack = createStack();
      new Meter(stack, 'MyMeter', {
        displayName: 'My Meter',
        eventName: 'my_event',
        defaultAggregation: { formula: 'count' },
      });

      const manifest = stack.synth();

      expect(manifest.resources[0].type).toBe('Stripe::BillingMeter');
    });
  });

  describe('Constructツリーとの統合', () => {
    it('Stackの子として登録される', () => {
      const stack = createStack();
      const meter = new Meter(stack, 'Meter1', {
        displayName: 'Meter',
        eventName: 'event',
        defaultAggregation: { formula: 'count' },
      });

      expect(stack.node.children).toContain(meter);
    });

    it('pathがStack/Meterの形式', () => {
      const stack = createStack();
      const meter = new Meter(stack, 'MyMeter', {
        displayName: 'Meter',
        eventName: 'event',
        defaultAggregation: { formula: 'count' },
      });

      expect(meter.node.path).toBe('TestStack/MyMeter');
    });
  });
});
