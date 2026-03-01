import { Construct, Resource, ResourceProps } from '@pricectl/core';
import type Stripe from 'stripe';

export interface MeterCustomerMapping {
  /**
   * The key in the usage event payload to use for mapping the event to a customer.
   */
  readonly eventPayloadKey: string;

  /**
   * The method for mapping a meter event to a customer. Must be `by_id`.
   * @default 'by_id'
   */
  readonly type?: 'by_id';
}

export interface MeterValueSettings {
  /**
   * The key in the usage event payload to use as the value for this meter.
   */
  readonly eventPayloadKey: string;
}

export interface MeterProps extends ResourceProps {
  /**
   * The meter's name, meant to be displayable.
   */
  readonly displayName: string;

  /**
   * The name of the usage event to record usage for.
   * Corresponds with the `event_name` field on usage events.
   */
  readonly eventName: string;

  /**
   * The default settings to aggregate a meter's events with.
   */
  readonly defaultAggregation: {
    /**
     * Specifies how events are aggregated. Allowed values are `count` to count the number of events
     * or `sum` to sum each event's value.
     */
    readonly formula: 'count' | 'sum';
  };

  /**
   * Fields that specify how to map a meter event to a customer.
   */
  readonly customerMapping?: MeterCustomerMapping;

  /**
   * The time window to pre-aggregate usage events for, if any.
   */
  readonly eventTimeWindow?: 'day' | 'hour';

  /**
   * Fields that specify how to calculate a usage event's value.
   */
  readonly valueSettings?: MeterValueSettings;
}

/**
 * Represents a Stripe Billing Meter
 *
 * A billing meter allows you to track usage of a particular event.
 * For example, you might create a billing meter to track the number of API calls
 * made by a particular user.
 *
 * @example
 * ```ts
 * new Meter(stack, 'ApiCalls', {
 *   displayName: 'API Calls',
 *   eventName: 'api_call',
 *   defaultAggregation: {
 *     formula: 'count',
 *   },
 * });
 * ```
 */
export class Meter extends Resource {
  public readonly displayName: string;
  public readonly eventName: string;
  public readonly defaultAggregation: { readonly formula: 'count' | 'sum' };
  public readonly customerMapping?: MeterCustomerMapping;
  public readonly eventTimeWindow?: 'day' | 'hour';
  public readonly valueSettings?: MeterValueSettings;

  constructor(scope: Construct, id: string, props: MeterProps) {
    super(scope, id, props);

    this.displayName = props.displayName;
    this.eventName = props.eventName;
    this.defaultAggregation = props.defaultAggregation;
    this.customerMapping = props.customerMapping;
    this.eventTimeWindow = props.eventTimeWindow;
    this.valueSettings = props.valueSettings;

    // Register resource metadata after all properties are initialized
    this.registerResourceMetadata();
  }

  protected get resourceType(): string {
    return 'Stripe::BillingMeter';
  }

  protected synthesizeProperties(): Record<string, unknown> {
    const params: Stripe.Billing.MeterCreateParams = {
      display_name: this.displayName,
      event_name: this.eventName,
      default_aggregation: {
        formula: this.defaultAggregation.formula,
      },
    };

    if (this.customerMapping !== undefined) {
      params.customer_mapping = {
        event_payload_key: this.customerMapping.eventPayloadKey,
        type: this.customerMapping.type ?? 'by_id',
      };
    }

    if (this.eventTimeWindow !== undefined) {
      params.event_time_window = this.eventTimeWindow;
    }

    if (this.valueSettings !== undefined) {
      params.value_settings = {
        event_payload_key: this.valueSettings.eventPayloadKey,
      };
    }

    return params as unknown as Record<string, unknown>;
  }
}
