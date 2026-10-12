import { ResourceManifest, StackManifest } from '@pricectl/core';
import { describeDeployPlan } from '../engine/deploy-plan';

const manifest: StackManifest = {
  stackId: 'Shop',
  tags: {},
  resources: [{ id: 'Prod', key: 'Shop_Prod', path: 'Shop/Prod', type: 'Stripe::Product', properties: { name: 'Widget' } }],
};

describe('describeDeployPlan', () => {
  it('lists every defined resource as created or updated', () => {
    const lines = describeDeployPlan(manifest);

    expect(lines).toContain('  + Shop/Prod [Stripe::Product]');
    expect(lines).toContain('  Total: 1 resource(s) would be created/updated');
  });

  it('lists resources that are no longer defined as removed', () => {
    const removals: ResourceManifest[] = [
      { id: 'OldPrice', key: 'Shop_OldPrice', path: 'Shop/OldPrice', type: 'Stripe::Price', properties: {} },
    ];

    const lines = describeDeployPlan(manifest, removals);

    expect(lines).toContain('  - Shop/OldPrice [Stripe::Price]');
    expect(lines).toContain('  Removed: 1 resource(s) would be removed (confirmation required unless --force)');
  });
});

