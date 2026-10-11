import { Stack } from '@pricectl/core';
import { Coupon, EntitlementFeature, Meter, Price, Product } from '../index';
import { API_KEY } from './helpers';

function propertiesOf(stack: Stack, id: string): Record<string, unknown> {
  const resource = stack.synth().resources.find((r) => r.id === id);
  if (!resource) throw new Error(`resource ${id} was not synthesized`);
  return resource.properties;
}

describe('Stackのtags', () => {
  function createTaggedStack(): Stack {
    return new Stack(undefined, 'Tagged', { apiKey: API_KEY, tags: { team: 'billing', env: 'prod' } });
  }

  it('メタデータを持つ全リソースのmetadataにtagsが入る', () => {
    const stack = createTaggedStack();
    const product = new Product(stack, 'Prod', { name: 'Widget' });
    new Price(stack, 'Monthly', { product, currency: 'usd', unitAmount: 100 });
    new Coupon(stack, 'Sale', { percentOff: 10, duration: 'once' });
    new EntitlementFeature(stack, 'Feature', { name: 'F', lookupKey: 'f' });

    for (const id of ['Prod', 'Monthly', 'Sale', 'Feature']) {
      expect(propertiesOf(stack, id).metadata).toEqual({ team: 'billing', env: 'prod' });
    }
  });

  it('リソース側のmetadataが同じキーのtagより優先される', () => {
    const stack = createTaggedStack();
    new Product(stack, 'Prod', { name: 'Widget', metadata: { env: 'staging', owner: 'me' } });

    expect(propertiesOf(stack, 'Prod').metadata).toEqual({ team: 'billing', env: 'staging', owner: 'me' });
  });

  it('メタデータを持たないMeterにはtagsを付けない', () => {
    const stack = createTaggedStack();
    new Meter(stack, 'Usage', { displayName: 'Usage', eventName: 'usage', defaultAggregation: { formula: 'count' } });

    expect(propertiesOf(stack, 'Usage')).not.toHaveProperty('metadata');
  });

  it('tagsが空ならmetadataを追加しない', () => {
    const stack = new Stack(undefined, 'Plain', { apiKey: API_KEY });
    new Product(stack, 'Prod', { name: 'Widget' });

    expect(propertiesOf(stack, 'Prod')).not.toHaveProperty('metadata');
  });
});
