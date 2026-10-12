import { describeDestroyPlan } from '../engine/destroy-plan';

describe('describeDestroyPlan', () => {
  it('lists each resource with what destroy would do to it', () => {
    const lines = describeDestroyPlan({
      stackId: 'Shop',
      resources: [
        { id: 'Monthly', path: 'Shop/Monthly', type: 'Stripe::Price', status: 'deactivated', physicalId: 'price_1' },
        { id: 'PricectlSale', path: 'Shop/PricectlSale', type: 'Stripe::Coupon', status: 'deleted', physicalId: 'PricectlSale' },
      ],
      errors: [],
    });

    expect(lines).toEqual([
      'The following resources will be deleted or deactivated:',
      '  - Shop/Monthly [Stripe::Price] (deactivate)',
      '  - Shop/PricectlSale [Stripe::Coupon] (delete)',
    ]);
  });

  it('says there is nothing to destroy when every resource is already gone or inactive', () => {
    const lines = describeDestroyPlan({ stackId: 'Shop', resources: [], errors: [] });

    expect(lines).toEqual([
      'Nothing to destroy: every resource of stack Shop is already deleted or inactive in Stripe.',
    ]);
  });

  it('lists the resources whose state in Stripe could not be read', () => {
    const lines = describeDestroyPlan({
      stackId: 'Shop',
      resources: [],
      errors: [{ id: 'Prod', type: 'Stripe::Product', error: 'Request timed out' }],
    });

    expect(lines).toEqual([
      'Could not read the current state of these resources in Stripe:',
      '  ✗ Prod [Stripe::Product]: Request timed out',
    ]);
  });
});
