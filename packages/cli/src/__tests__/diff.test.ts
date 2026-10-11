import { Stack } from '@pricectl/core';
import { Product } from '@pricectl/constructs';
import { diffResource } from '../engine/diff';
import productFixture from './fixtures/stripe/product.json';

function synthesizedProperties(stack: Stack, logicalId: string): Record<string, unknown> {
  const resource = stack.synth().resources.find((r) => r.id === logicalId);
  if (!resource) throw new Error(`resource ${logicalId} was not synthesized`);
  return resource.properties;
}

describe('diffResource', () => {
  it('reports a changed product name as a change', () => {
    const stack = new Stack(undefined, 'FxStack', { apiKey: 'sk_test_dummy' });
    new Product(stack, 'FxProd', { name: 'Renamed product', description: 'fixture' });

    const diff = diffResource('Stripe::Product', synthesizedProperties(stack, 'FxProd'), productFixture as never);

    expect(diff.changed).toBe(true);
    expect(diff.desired).toContain('Renamed product');
    expect(diff.current).toContain('pricectl fixture product');
  });
});
