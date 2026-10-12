import { StackManifest } from '@pricectl/core';
import { findOrphans } from '../engine/orphans';
import { StateManager } from '../engine/state';
import { InMemoryStateStore } from './helpers/in-memory-state-store';

function stateWith(...entries: Array<{ logicalId: string; physicalId: string; type: string }>): StateManager {
  const state = new StateManager(new InMemoryStateStore());
  for (const entry of entries) {
    state.setResource('Shop', { ...entry, path: `Shop/${entry.logicalId}`, lastDeployedAt: '', propertiesHash: '' });
  }
  return state;
}

function manifestWith(resources: StackManifest['resources']): StackManifest {
  return { stackId: 'Shop', tags: {}, resources };
}

describe('findOrphans', () => {
  it('does not remove a resource that a defined resource still refers to by its Stripe ID', () => {
    const state = stateWith(
      { logicalId: 'ApiCalls', physicalId: 'mtr_123', type: 'Stripe::BillingMeter' },
      { logicalId: 'Prod', physicalId: 'prod_123', type: 'Stripe::Product' },
      { logicalId: 'Support', physicalId: 'feat_123', type: 'Stripe::EntitlementFeature' },
    );
    const manifest = manifestWith([
      {
        id: 'Usage',
        key: 'TestStack_Usage',
        path: 'Shop/Usage',
        type: 'Stripe::Price',
        properties: { product: 'prod_123', recurring: { interval: 'month', usage_type: 'metered', meter: 'mtr_123' } },
      },
      { id: 'Other', key: 'TestStack_Other', path: 'Shop/Other', type: 'Stripe::Product', properties: { name: 'Other', features: ['feat_123'] } },
    ]);

    expect(findOrphans(manifest, state)).toEqual([]);
  });

  it('removes resource types it does not know after the known ones', () => {
    const state = stateWith(
      { logicalId: 'Link', physicalId: 'plink_1', type: 'Stripe::PaymentLink' },
      { logicalId: 'Prod', physicalId: 'prod_1', type: 'Stripe::Product' },
      { logicalId: 'Monthly', physicalId: 'price_1', type: 'Stripe::Price' },
    );

    expect(findOrphans(manifestWith([]), state).map((o) => o.id)).toEqual(['Monthly', 'Prod', 'Link']);
  });
});
