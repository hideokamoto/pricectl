import { StackManifest } from '@pricectl/core';
import { describeDeployPlan } from '../engine/deploy-plan';

const manifest: StackManifest = {
  stackId: 'Shop',
  tags: {},
  resources: [{ id: 'Prod', path: 'Shop/Prod', type: 'Stripe::Product', properties: { name: 'Widget' } }],
};

describe('describeDeployPlan', () => {
  it('lists every defined resource as created or updated', () => {
    const lines = describeDeployPlan(manifest);

    expect(lines).toContain('  + Shop/Prod [Stripe::Product]');
    expect(lines).toContain('  Total: 1 resource(s) would be created/updated');
  });
});
