/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory fake of the subset of the Stripe API used by pricectl.
 *
 * Stripe is an external system, so tests replace it at the boundary. Unlike
 * hand-written mocks, this fake returns objects shaped like real Stripe
 * responses (see ../fixtures/stripe/, recorded from Stripe test mode with
 * API version 2024-12-18.acacia) and reproduces the following observed
 * Stripe behaviors:
 *
 * - Fields that were not set come back as null or as Stripe defaults
 *   (e.g. interval_count: 1, usage_type: 'licensed', tax_behavior: 'unspecified').
 * - Price tiers are omitted unless expanded, and `up_to: 'inf'` comes back as null.
 * - A lookup_key can belong to only one price unless transfer_lookup_key is set.
 * - A product that has prices cannot be deleted.
 * - An inactive entitlement feature cannot be updated (not even reactivated).
 * - List endpoints return inactive features and meters too.
 * - The Search API is eventually consistent: newly created objects are not
 *   searchable until indexSearch() is called.
 */

type StripeObject = Record<string, any>;

interface RawStripeError {
  message: string;
  type?: string;
  code?: string;
  param?: string;
}

/** Mirrors the fields of StripeError that pricectl relies on. */
export class FakeStripeError extends Error {
  public readonly type: string;
  public readonly rawType: string;
  public readonly code?: string;
  public readonly param?: string;

  constructor(raw: RawStripeError) {
    super(raw.message);
    this.rawType = raw.type ?? 'invalid_request_error';
    this.type = 'StripeInvalidRequestError';
    this.code = raw.code;
    this.param = raw.param;
  }
}

function resourceMissing(kind: string, id: string): FakeStripeError {
  return new FakeStripeError({ message: `No such ${kind}: '${id}'`, code: 'resource_missing', param: 'id' });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** List results are both awaitable (first page) and async-iterable (auto-pagination), like the SDK. */
function listResult(items: StripeObject[]) {
  const page = { object: 'list', data: items, has_more: false };
  return {
    then(resolve: (value: typeof page) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(page).then(resolve, reject);
    },
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function mergeMetadata(current: Record<string, string>, update?: Record<string, string>): Record<string, string> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(update ?? {})) {
    if (value === '' || value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function metadataQueryValue(query: string): string | undefined {
  return /metadata\["pricectl_id"\]:"((?:[^"\\]|\\.)*)"/.exec(query)?.[1]?.replace(/\\(.)/g, '$1');
}

function wantsTiers(expand?: string[]): boolean {
  return (expand ?? []).some((e) => e === 'tiers' || e === 'data.tiers');
}

export class FakeStripe {
  private seq = 0;
  private readonly searchable = new Set<string>();
  private readonly failures = new Map<string, FakeStripeError>();

  readonly productStore = new Map<string, StripeObject>();
  readonly priceStore = new Map<string, StripeObject>();
  readonly couponStore = new Map<string, StripeObject>();
  readonly featureStore = new Map<string, StripeObject>();
  readonly meterStore = new Map<string, StripeObject>();

  /** Make every object created so far visible to the Search API. */
  indexSearch(): void {
    for (const store of [this.productStore, this.priceStore]) {
      for (const id of store.keys()) this.searchable.add(id);
    }
  }

  /** Make the next call to `operation` (e.g. 'prices.create') fail with the given error. */
  failNext(operation: string, error: RawStripeError): void {
    this.failures.set(operation, new FakeStripeError(error));
  }

  /** Store a recorded Stripe object as-is. Seeded objects are searchable. */
  seed(store: 'products' | 'prices' | 'coupons' | 'features' | 'meters', object: StripeObject): void {
    const target = {
      products: this.productStore,
      prices: this.priceStore,
      coupons: this.couponStore,
      features: this.featureStore,
      meters: this.meterStore,
    }[store];
    target.set(object.id, clone(object));
    this.searchable.add(object.id);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_fake${String(this.seq).padStart(6, '0')}`;
  }

  private checkFailure(operation: string): void {
    const failure = this.failures.get(operation);
    if (failure) {
      this.failures.delete(operation);
      throw failure;
    }
  }

  private now(): number {
    return 1791724000 + this.seq;
  }

  /**
   * A lookup key can belong to only one price: take it from its current holder when
   * transfer_lookup_key is set, otherwise reject the request as Stripe does.
   */
  private claimLookupKey(lookupKey: string, transfer: boolean, claimantId?: string): void {
    const holder = [...this.priceStore.values()].find((p) => p.lookup_key === lookupKey && p.id !== claimantId);
    if (!holder) return;
    if (!transfer) {
      throw new FakeStripeError({
        message: `Price ${holder.id} already uses this \`lookup_key\`. Use a unique key or transfer the key from that price.`,
        param: 'lookup_key',
      });
    }
    holder.lookup_key = null;
  }

  private priceView(price: StripeObject, expand?: string[]): StripeObject {
    const view = clone(price);
    if (!wantsTiers(expand)) delete view.tiers;
    return view;
  }

  readonly products = {
    create: async (params: StripeObject) => {
      this.checkFailure('products.create');
      const product = {
        active: params.active ?? true,
        attributes: [],
        created: this.now(),
        default_price: null,
        description: params.description ?? null,
        id: this.nextId('prod'),
        images: params.images ?? [],
        livemode: false,
        marketing_features: [],
        metadata: mergeMetadata({}, params.metadata),
        name: params.name,
        object: 'product',
        package_dimensions: null,
        shippable: null,
        statement_descriptor: params.statement_descriptor ?? null,
        tax_code: params.tax_code ?? null,
        tax_details: null,
        type: 'service',
        unit_label: params.unit_label ?? null,
        updated: this.now(),
        url: params.url ?? null,
      };
      this.productStore.set(product.id, product);
      return clone(product);
    },
    retrieve: async (id: string) => {
      const product = this.productStore.get(id);
      if (!product) throw resourceMissing('product', id);
      return clone(product);
    },
    update: async (id: string, params: StripeObject) => {
      this.checkFailure('products.update');
      const product = this.productStore.get(id);
      if (!product) throw resourceMissing('product', id);
      const { metadata, ...rest } = params;
      Object.assign(product, rest, { metadata: mergeMetadata(product.metadata, metadata), updated: this.now() });
      return clone(product);
    },
    del: async (id: string) => {
      if (!this.productStore.has(id)) throw resourceMissing('product', id);
      if ([...this.priceStore.values()].some((p) => p.product === id)) {
        throw new FakeStripeError({
          message: 'This product cannot be deleted because it has one or more user-created prices.',
        });
      }
      this.productStore.delete(id);
      return { id, object: 'product', deleted: true };
    },
    search: async (params: { query: string; limit?: number }) => {
      const value = metadataQueryValue(params.query);
      const data = [...this.productStore.values()]
        .filter((p) => this.searchable.has(p.id) && p.metadata.pricectl_id === value)
        .slice(0, params.limit ?? 10)
        .map(clone);
      return { object: 'search_result', data, has_more: false };
    },
    list: (params: { active?: boolean } = {}) => {
      const data = [...this.productStore.values()]
        .filter((p) => params.active === undefined || p.active === params.active)
        .map(clone);
      return listResult(data);
    },
  };

  readonly prices = {
    create: async (params: StripeObject) => {
      this.checkFailure('prices.create');
      if (!this.productStore.has(params.product)) {
        throw new FakeStripeError({ message: `No such product: '${params.product}'`, code: 'resource_missing', param: 'product' });
      }
      if (params.lookup_key) this.claimLookupKey(params.lookup_key, Boolean(params.transfer_lookup_key));
      const recurring = params.recurring
        ? {
            aggregate_usage: null,
            interval: params.recurring.interval,
            interval_count: params.recurring.interval_count ?? 1,
            meter: params.recurring.meter ?? null,
            trial_period_days: params.recurring.trial_period_days ?? null,
            usage_type: params.recurring.usage_type ?? 'licensed',
          }
        : null;
      const unitAmount = params.unit_amount ?? null;
      const price: StripeObject = {
        active: params.active ?? true,
        billing_scheme: params.billing_scheme ?? 'per_unit',
        created: this.now(),
        currency: params.currency,
        custom_unit_amount: null,
        id: this.nextId('price'),
        livemode: false,
        lookup_key: params.lookup_key ?? null,
        metadata: mergeMetadata({}, params.metadata),
        nickname: params.nickname ?? null,
        object: 'price',
        product: params.product,
        recurring,
        tax_behavior: params.tax_behavior ?? 'unspecified',
        tiers_mode: params.tiers_mode ?? null,
        transform_quantity: params.transform_quantity ?? null,
        type: recurring ? 'recurring' : 'one_time',
        unit_amount: unitAmount,
        unit_amount_decimal: unitAmount !== null ? String(unitAmount) : params.unit_amount_decimal ?? null,
      };
      if (params.tiers) {
        price.tiers = params.tiers.map((tier: StripeObject) => ({
          flat_amount: tier.flat_amount ?? null,
          flat_amount_decimal: tier.flat_amount !== undefined ? String(tier.flat_amount) : null,
          unit_amount: tier.unit_amount ?? null,
          unit_amount_decimal: tier.unit_amount !== undefined ? String(tier.unit_amount) : null,
          up_to: tier.up_to === 'inf' ? null : tier.up_to,
        }));
      }
      this.priceStore.set(price.id, price);
      return this.priceView(price);
    },
    retrieve: async (id: string, params: { expand?: string[] } = {}) => {
      const price = this.priceStore.get(id);
      if (!price) throw resourceMissing('price', id);
      return this.priceView(price, params.expand);
    },
    update: async (id: string, params: StripeObject) => {
      this.checkFailure('prices.update');
      const price = this.priceStore.get(id);
      if (!price) throw resourceMissing('price', id);
      const { metadata, transfer_lookup_key: transfer, ...rest } = params;
      if (rest.lookup_key) this.claimLookupKey(rest.lookup_key, Boolean(transfer), id);
      Object.assign(price, rest, { metadata: mergeMetadata(price.metadata, metadata) });
      return this.priceView(price);
    },
    search: async (params: { query: string; limit?: number; expand?: string[] }) => {
      const value = metadataQueryValue(params.query);
      const data = [...this.priceStore.values()]
        .filter((p) => this.searchable.has(p.id) && p.metadata.pricectl_id === value)
        .slice(0, params.limit ?? 10)
        .map((p) => this.priceView(p, params.expand));
      return { object: 'search_result', data, has_more: false };
    },
    list: (params: { product?: string; active?: boolean; expand?: string[] } = {}) => {
      const data = [...this.priceStore.values()]
        .filter((p) => params.product === undefined || p.product === params.product)
        .filter((p) => params.active === undefined || p.active === params.active)
        .map((p) => this.priceView(p, params.expand));
      return listResult(data);
    },
  };

  readonly coupons = {
    create: async (params: StripeObject) => {
      this.checkFailure('coupons.create');
      const id = params.id ?? this.nextId('coupon');
      if (this.couponStore.has(id)) {
        throw new FakeStripeError({ message: 'Coupon already exists.', code: 'resource_already_exists', param: 'id' });
      }
      const coupon: StripeObject = {
        amount_off: params.amount_off ?? null,
        created: this.now(),
        currency: params.currency ?? null,
        duration: params.duration,
        duration_in_months: params.duration_in_months ?? null,
        id,
        livemode: false,
        max_redemptions: params.max_redemptions ?? null,
        metadata: mergeMetadata({}, params.metadata),
        name: params.name ?? null,
        object: 'coupon',
        percent_off: params.percent_off ?? null,
        redeem_by: params.redeem_by ?? null,
        times_redeemed: 0,
        valid: true,
      };
      this.couponStore.set(id, coupon);
      return clone(coupon);
    },
    retrieve: async (id: string) => {
      const coupon = this.couponStore.get(id);
      if (!coupon) throw resourceMissing('coupon', id);
      return clone(coupon);
    },
    update: async (id: string, params: { name?: string; metadata?: Record<string, string> }) => {
      const coupon = this.couponStore.get(id);
      if (!coupon) throw resourceMissing('coupon', id);
      if (params.name !== undefined) coupon.name = params.name;
      coupon.metadata = mergeMetadata(coupon.metadata, params.metadata);
      return clone(coupon);
    },
    del: async (id: string) => {
      if (!this.couponStore.delete(id)) throw resourceMissing('coupon', id);
      return { id, object: 'coupon', deleted: true };
    },
  };

  readonly entitlements = {
    features: {
      create: async (params: StripeObject) => {
        const feature = {
          active: true,
          id: this.nextId('feat_test'),
          livemode: false,
          lookup_key: params.lookup_key,
          metadata: mergeMetadata({}, params.metadata),
          name: params.name,
          object: 'entitlements.feature',
        };
        this.featureStore.set(feature.id, feature);
        return clone(feature);
      },
      retrieve: async (id: string) => {
        const feature = this.featureStore.get(id);
        if (!feature) throw resourceMissing('feature', id);
        return clone(feature);
      },
      update: async (id: string, params: StripeObject) => {
        const feature = this.featureStore.get(id);
        if (!feature) throw resourceMissing('feature', id);
        if (!feature.active) {
          throw new FakeStripeError({ message: 'You cannot update an inactive feature' });
        }
        const { metadata, ...rest } = params;
        Object.assign(feature, rest, { metadata: mergeMetadata(feature.metadata, metadata) });
        return clone(feature);
      },
      list: () => listResult([...this.featureStore.values()].map(clone)),
    },
  };

  readonly billing = {
    meters: {
      create: async (params: StripeObject) => {
        const meter = {
          created: this.now(),
          customer_mapping: params.customer_mapping ?? { event_payload_key: 'stripe_customer_id', type: 'by_id' },
          default_aggregation: params.default_aggregation,
          display_name: params.display_name,
          event_name: params.event_name,
          event_time_window: params.event_time_window ?? null,
          id: this.nextId('mtr_test'),
          livemode: false,
          object: 'billing.meter',
          status: 'active',
          status_transitions: { deactivated_at: null as number | null },
          updated: this.now(),
          value_settings: params.value_settings ?? { event_payload_key: 'value' },
        };
        this.meterStore.set(meter.id, meter);
        return clone(meter);
      },
      retrieve: async (id: string) => {
        const meter = this.meterStore.get(id);
        if (!meter) throw resourceMissing('billing.meter', id);
        return clone(meter);
      },
      update: async (id: string, params: { display_name?: string }) => {
        const meter = this.meterStore.get(id);
        if (!meter) throw resourceMissing('billing.meter', id);
        if (params.display_name !== undefined) meter.display_name = params.display_name;
        return clone(meter);
      },
      deactivate: async (id: string) => {
        const meter = this.meterStore.get(id);
        if (!meter) throw resourceMissing('billing.meter', id);
        meter.status = 'inactive';
        meter.status_transitions = { deactivated_at: this.now() };
        return clone(meter);
      },
      reactivate: async (id: string) => {
        const meter = this.meterStore.get(id);
        if (!meter) throw resourceMissing('billing.meter', id);
        meter.status = 'active';
        meter.status_transitions = { deactivated_at: null };
        return clone(meter);
      },
      list: () => listResult([...this.meterStore.values()].map(clone)),
    },
  };

  /** Prices that carry the given pricectl logical ID. */
  pricesFor(logicalId: string): StripeObject[] {
    return [...this.priceStore.values()].filter((p) => p.metadata.pricectl_id === logicalId).map(clone);
  }

  /** Products that carry the given pricectl logical ID. */
  productsFor(logicalId: string): StripeObject[] {
    return [...this.productStore.values()].filter((p) => p.metadata.pricectl_id === logicalId).map(clone);
  }
}
