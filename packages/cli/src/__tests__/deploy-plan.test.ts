import { ResourceManifest, StackManifest } from '@pricectl/core';
import { describeDeployPlan } from '../engine/deploy-plan';
import type { DeployPlan } from '../engine/deployer';

const manifest: StackManifest = {
  stackId: 'Shop',
  tags: {},
  resources: [{ id: 'Prod', path: 'Shop/Prod', type: 'Stripe::Product', properties: { name: 'Widget' } }],
};

function planWith(action: DeployPlan['resources'][number]['action']): DeployPlan {
  return {
    stackId: 'Shop',
    resources: [{ id: 'Prod', path: 'Shop/Prod', type: 'Stripe::Product', action }],
    errors: [],
  };
}

describe('describeDeployPlan', () => {
  it('lists a resource missing from Stripe as created, with its properties', () => {
    const lines = describeDeployPlan(manifest, planWith('create'));

    expect(lines).toContain('  + Shop/Prod [Stripe::Product] (create)');
    expect(lines).toContain('  Created: 1');
  });

  it('lists a resource that differs from Stripe as updated', () => {
    const lines = describeDeployPlan(manifest, planWith('update'));

    expect(lines).toContain('  ~ Shop/Prod [Stripe::Product] (update)');
    expect(lines).toContain('  Updated: 1');
  });

  it('lists a price that has to be recreated as replaced', () => {
    const lines = describeDeployPlan(manifest, planWith('replace'));

    expect(lines).toContain('  ~ Shop/Prod [Stripe::Product] (replace)');
    expect(lines).toContain('  Replaced: 1');
  });

  it('lists a resource that matches Stripe as unchanged, without its properties', () => {
    const lines = describeDeployPlan(manifest, planWith('unchanged'));

    expect(lines).toContain('  = Shop/Prod [Stripe::Product] (unchanged)');
    expect(lines).toContain('  Unchanged: 1');
    expect(lines).not.toContain('    Properties:');
  });

  it('lists resources that are no longer defined as removed', () => {
    const removals: ResourceManifest[] = [
      { id: 'OldPrice', path: 'Shop/OldPrice', type: 'Stripe::Price', properties: {} },
    ];

    const lines = describeDeployPlan(manifest, planWith('unchanged'), removals);

    expect(lines).toContain('  - Shop/OldPrice [Stripe::Price]');
    expect(lines).toContain('  Removed: 1 resource(s) would be removed (confirmation required unless --force)');
  });

  it('lists resources whose state could not be read from Stripe', () => {
    const plan: DeployPlan = {
      stackId: 'Shop',
      resources: [],
      errors: [{ id: 'Prod', type: 'Stripe::Product', error: 'boom' }],
    };

    const lines = describeDeployPlan(manifest, plan);

    expect(lines).toContain('  ✗ Prod [Stripe::Product]: boom');
  });
});
