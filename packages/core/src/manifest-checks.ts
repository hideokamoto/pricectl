import type { ResourceManifest, StackManifest } from './stack';

const PRICE = 'Stripe::Price';

/**
 * Check a synthesized definition on its own, without Stripe: the mistakes that Stripe would
 * reject or that would make two definitions fight over one object. Returns one message per
 * problem, empty when the definition is consistent.
 */
export function checkManifest(manifest: StackManifest): string[] {
  const prices = manifest.resources.filter((r) => r.type === PRICE);
  return [
    ...sharedPriceLookupKeys(prices),
    ...sharedKeys(manifest.resources, 'Stripe::EntitlementFeature', (r) => stringOrUndefined(r.properties.lookup_key), {
      plural: 'Features',
      what: 'the lookup key',
      rule: 'A lookup key belongs to one feature.',
    }),
    ...sharedKeys(manifest.resources, 'Stripe::BillingMeter', (r) => stringOrUndefined(r.properties.event_name), {
      plural: 'Meters',
      what: 'the event name',
      rule: 'An event name belongs to one active meter.',
    }),
    ...defaultPriceProblems(prices),
  ];
}

/** The lookup key a price has: the one its definition sets, or its derived key. */
function priceLookupKey(price: ResourceManifest): string {
  const explicit = price.properties.lookup_key;
  return typeof explicit === 'string' ? explicit : price.key;
}

function sharedPriceLookupKeys(prices: ResourceManifest[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, ResourceManifest>();
  for (const price of prices) {
    const key = priceLookupKey(price);
    const other = seen.get(key);
    if (other) {
      problems.push(
        `Prices "${other.path}" and "${price.path}" both use the lookup key "${key}". ` +
          'A lookup key belongs to one price.',
      );
    } else {
      seen.set(key, price);
    }
  }
  return problems;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Two resources of one type that use the same key would plan changes to the same Stripe object. */
function sharedKeys(
  resources: ResourceManifest[],
  type: string,
  keyOf: (resource: ResourceManifest) => string | undefined,
  words: { plural: string; what: string; rule: string },
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, ResourceManifest>();
  for (const resource of resources.filter((r) => r.type === type)) {
    const key = keyOf(resource);
    if (key === undefined) continue;
    const other = seen.get(key);
    if (other) {
      problems.push(`${words.plural} "${other.path}" and "${resource.path}" both use ${words.what} "${key}". ${words.rule}`);
    } else {
      seen.set(key, resource);
    }
  }
  return problems;
}

function defaultPriceProblems(prices: ResourceManifest[]): string[] {
  const problems: string[] = [];
  const defaultOfProduct = new Map<unknown, ResourceManifest>();
  for (const price of prices.filter((p) => p.isDefault)) {
    if (price.properties.active === false) {
      problems.push(
        `Price "${price.path}" is declared as a default price but has active: false. ` +
          'A default price must be on sale.',
      );
    }
    const product = price.properties.product;
    const other = defaultOfProduct.get(product);
    if (other) {
      problems.push(
        `Prices "${other.path}" and "${price.path}" are both declared as the default price of product "${String(product)}". ` +
          'A product has one default price.',
      );
    } else {
      defaultOfProduct.set(product, price);
    }
  }
  return problems;
}
