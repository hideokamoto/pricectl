/* eslint-disable @typescript-eslint/no-explicit-any */
import { asSdkPrice } from './sdk-shapes';
/**
 * In-memory fake of the subset of the Stripe API used by pricectl.
 *
 * Stripe is an external system, so tests replace it at the boundary. Unlike
 * hand-written mocks, this fake returns objects shaped like real Stripe
 * responses (see ../fixtures/stripe/, recorded from Stripe test mode with
 * API version 2026-09-30.endive) and reproduces the following observed
 * Stripe behaviors:
 *
 * - Fields that were not set come back as null or as Stripe defaults
 *   (e.g. interval_count: 1, usage_type: 'licensed', tax_behavior: 'unspecified').
 * - Price tiers are omitted unless expanded, and `up_to: 'inf'` comes back as null.
 * - A lookup_key can belong to only one price unless transfer_lookup_key is set.
 * - A product that has prices cannot be deleted.
 * - An inactive entitlement feature cannot be updated (not even reactivated).
 * - An inactive meter cannot be deactivated again.
 * - List endpoints return inactive features and meters too.
 * - stripe-node (v21+) returns price decimal_string fields as Stripe.Decimal objects.
 * - The Search API is eventually consistent: newly created objects are not
 *   searchable until indexSearch() is called.
 * - Products reject parameters that are not product fields.
 *
 * Product features (products.createFeature/listFeatures/deleteFeature) return the
 * shape recorded in ../fixtures/stripe/product-features-list.json.
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

interface ListPage {
  object: 'list';
  data: StripeObject[];
  has_more: boolean;
}

/** A list result is awaitable (first page) and async-iterable (auto-pagination), like the SDK's. */
type ListResult = PromiseLike<ListPage> & AsyncIterable<StripeObject>;

/** A list call Stripe rejects: awaiting it or iterating it throws. */
function failingListResult(error: FakeStripeError): ListResult {
  return {
    then: (onfulfilled, onrejected) => Promise.reject(error).then(onfulfilled, onrejected),
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator](): AsyncGenerator<StripeObject> {
      throw error;
    },
  };
}

/** List results are both awaitable (first page) and async-iterable (auto-pagination), like the SDK. */
function listResult(items: StripeObject[]): ListResult {
  const page: ListPage = { object: 'list', data: items, has_more: false };
  return {
    then: (onfulfilled, onrejected) => Promise.resolve(page).then(onfulfilled, onrejected),
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

const PRODUCT_PARAMS = new Set([
  'name', 'active', 'description', 'images', 'metadata', 'url',
  'unit_label', 'statement_descriptor', 'tax_code',
]);

function rejectUnknownProductParams(params: StripeObject, extra: string[] = []): void {
  const unknown = Object.keys(params).find((key) => !PRODUCT_PARAMS.has(key) && !extra.includes(key));
  if (unknown) {
    throw new FakeStripeError({ message: `Received unknown parameter: ${unknown}`, param: unknown });
  }
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
  /** Product ID → attached product_feature objects */
  readonly productFeatureStore = new Map<string, StripeObject[]>();

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

  /** Stripe allows one active meter per event name. */
  private assertNoActiveMeter(eventName: string, action: 'create' | 'reactivate'): void {
    if (![...this.meterStore.values()].some((m) => m.status === 'active' && m.event_name === eventName)) return;
    throw new FakeStripeError({
      message:
        action === 'create'
          ? `An active meter already exists for event name '${eventName}'. To create a new meter with the same event name, first deactivate the currently active meter.`
          : 'This meter cannot be reactivated because an active meter already exists with the same event name.',
    });
  }

  /** A stored price as the SDK hands it to callers (decimal fields as Stripe.Decimal). */
  private priceView(price: StripeObject, expand?: string[]): StripeObject {
    const view = clone(price);
    if (!wantsTiers(expand)) delete view.tiers;
    return asSdkPrice(view);
  }

  /** A product ID chosen by the caller: Stripe accepts [A-Za-z0-9_-] up to 200 characters, once. */
  private checkedProductId(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new FakeStripeError({
        message: `This value must match the regex pattern. (/\\A[a-zA-Z0-9_\\-]+\\z/ does not match for the value ${id}).`,
        param: 'id',
      });
    }
    if (id.length > 200) {
      throw new FakeStripeError({ message: `Invalid string: ${id.slice(0, 8)}...; must be at most 200 characters`, param: 'id' });
    }
    if (this.productStore.has(id)) {
      throw new FakeStripeError({ message: 'Product already exists.', code: 'resource_already_exists', param: 'id' });
    }
    return id;
  }

  /** A default price must be an active price of the product; an empty string unsets it. */
  private checkedDefaultPrice(productId: string, priceId: string): string | null {
    if (priceId === '') return null;
    const price = this.priceStore.get(priceId);
    if (!price) throw resourceMissing('price', priceId);
    if (price.product !== productId) {
      throw new FakeStripeError({ message: `Provided price (${priceId}) belongs to a different product`, param: 'default_price' });
    }
    if (!price.active) {
      throw new FakeStripeError({ message: `The price ${priceId} is not active and cannot be the default price`, param: 'default_price' });
    }
    return priceId;
  }

  readonly products = {
    create: async (params: StripeObject) => {
      this.checkFailure('products.create');
      rejectUnknownProductParams(params, ['id']);
      const id = params.id === undefined ? this.nextId('prod') : this.checkedProductId(params.id);
      const product = {
        active: params.active ?? true,
        attributes: [],
        created: this.now(),
        default_price: null,
        description: params.description ?? null,
        id,
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
      rejectUnknownProductParams(params, ['default_price']);
      const product = this.productStore.get(id);
      if (!product) throw resourceMissing('product', id);
      const { metadata, default_price: defaultPrice, ...rest } = params;
      if (defaultPrice !== undefined) product.default_price = this.checkedDefaultPrice(id, defaultPrice);
      Object.assign(product, rest, { metadata: mergeMetadata(product.metadata, metadata), updated: this.now() });
      return clone(product);
    },
    del: async (id: string) => {
      this.checkFailure('products.del');
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
    createFeature: async (productId: string, params: { entitlement_feature: string }) => {
      this.checkFailure('products.createFeature');
      if (!this.productStore.has(productId)) throw resourceMissing('product', productId);
      const feature = this.featureStore.get(params.entitlement_feature);
      if (!feature) throw resourceMissing('feature', params.entitlement_feature);
      const attached = {
        id: this.nextId('prodft'),
        object: 'product_feature',
        livemode: false,
        entitlement_feature: clone(feature),
      };
      this.productFeatureStore.set(productId, [...(this.productFeatureStore.get(productId) ?? []), attached]);
      return clone(attached);
    },
    listFeatures: (productId: string) => listResult((this.productFeatureStore.get(productId) ?? []).map(clone)),
    deleteFeature: async (productId: string, productFeatureId: string) => {
      const attached = this.productFeatureStore.get(productId) ?? [];
      if (!attached.some((f) => f.id === productFeatureId)) throw resourceMissing('product_feature', productFeatureId);
      this.productFeatureStore.set(productId, attached.filter((f) => f.id !== productFeatureId));
      return { id: productFeatureId, object: 'product_feature', deleted: true };
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
      if (rest.active === false && [...this.productStore.values()].some((p) => p.default_price === id)) {
        throw new FakeStripeError({
          message: 'This price cannot be archived because it is the default price of its product.',
          param: 'active',
        });
      }
      if (rest.lookup_key) this.claimLookupKey(rest.lookup_key, Boolean(transfer), id);
      Object.assign(price, rest, { metadata: mergeMetadata(price.metadata, metadata) });
      if (price.lookup_key === '') price.lookup_key = null;
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
    list: (params: { product?: string; active?: boolean; lookup_keys?: string[]; limit?: number; expand?: string[] } = {}) => {
      if ((params.lookup_keys?.length ?? 0) > 10) {
        return failingListResult(new FakeStripeError({ message: 'Array lookup_keys exceeded maximum 10 allowed elements.', param: 'lookup_keys' }));
      }
      const data = [...this.priceStore.values()]
        .filter((p) => params.lookup_keys === undefined || params.lookup_keys.includes(p.lookup_key))
        .filter((p) => params.product === undefined || p.product === params.product)
        .filter((p) => params.active === undefined || p.active === params.active)
        .slice(0, params.limit ?? Infinity)
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
        if ([...this.featureStore.values()].some((f) => f.active && f.lookup_key === params.lookup_key)) {
          throw new FakeStripeError({
            message: `You are already using the feature lookup_key \`${params.lookup_key}\`. Ensure \`lookup_key\` is unique for each of your features.`,
            param: 'lookup_key',
          });
        }
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
      /** Like Stripe, the list returns inactive features too unless `archived: false` is given. */
      list: (params: { lookup_key?: string; archived?: boolean } = {}) =>
        listResult(
          [...this.featureStore.values()]
            .filter((f) => params.lookup_key === undefined || f.lookup_key === params.lookup_key)
            .filter((f) => params.archived !== false || f.active)
            .map(clone),
        ),
    },
  };

  readonly billing = {
    meters: {
      create: async (params: StripeObject) => {
        this.assertNoActiveMeter(params.event_name, 'create');
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
        if (meter.status !== 'active') {
          // Recorded in ../fixtures/stripe/error-meter-already-deactivated.json
          throw new FakeStripeError({ message: 'meter_already_deactivated' });
        }
        meter.status = 'inactive';
        meter.status_transitions = { deactivated_at: this.now() };
        return clone(meter);
      },
      reactivate: async (id: string) => {
        const meter = this.meterStore.get(id);
        if (!meter) throw resourceMissing('billing.meter', id);
        this.assertNoActiveMeter(meter.event_name, 'reactivate');
        meter.status = 'active';
        meter.status_transitions = { deactivated_at: null };
        return clone(meter);
      },
      list: (params: { status?: string } = {}) =>
        listResult([...this.meterStore.values()].filter((m) => params.status === undefined || m.status === params.status).map(clone)),
    },
  };

  /** Prices that carry the given pricectl logical ID. */
  pricesFor(logicalId: string): StripeObject[] {
    return [...this.priceStore.values()].filter((p) => p.metadata.pricectl_id === logicalId).map(clone);
  }

  /** IDs of the entitlement features attached to a product. */
  featuresOf(productId: string): string[] {
    return (this.productFeatureStore.get(productId) ?? []).map((f) => f.entitlement_feature.id);
  }

  /** Products that carry the given pricectl logical ID. */
  productsFor(logicalId: string): StripeObject[] {
    return [...this.productStore.values()].filter((p) => p.metadata.pricectl_id === logicalId).map(clone);
  }
}
