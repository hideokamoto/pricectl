import { describeResult } from '../engine/describe-result';
import type { ApplyResult } from '../engine/apply-plan';

const result = (items: ApplyResult['items'], removalSkipped = false): ApplyResult => ({ stackId: 'Shop', items, removalSkipped });

const applied = (overrides: Partial<ApplyResult['items'][number]>) => ({
  id: 'Monthly',
  path: 'Shop/Monthly',
  type: 'Stripe::Price',
  operation: 'create' as const,
  ...overrides,
});

describe('describeResult', () => {
  it('lists what was changed and counts every operation', () => {
    const lines = describeResult(
      result([
        applied({ physicalId: 'price_1' }),
        applied({ id: 'Pro', path: 'Shop/Pro', type: 'Stripe::Product', operation: 'update', physicalId: 'Shop_Pro' }),
        applied({ id: 'Shop_Old', path: 'Shop_Old', operation: 'remove' }),
        applied({ id: 'Yearly', path: 'Shop/Yearly', operation: 'unchanged' }),
      ]),
    );

    expect(lines).toEqual([
      '  created Shop/Monthly [Stripe::Price] → price_1',
      '  updated Shop/Pro [Stripe::Product] → Shop_Pro',
      '  removed Shop_Old [Stripe::Price]',
      '',
      'Created: 1, updated: 1, removed: 1, unchanged: 1.',
    ]);
  });

  it('shows errors and says when removal was skipped because of them', () => {
    const lines = describeResult(result([applied({ error: 'Request timed out' }), applied({ id: 'Old', path: 'Shop_Old', operation: 'remove' })], true));

    expect(lines).toContain('  ✗ Shop/Monthly [Stripe::Price]: Request timed out');
    expect(lines).toContain('Resources that are no longer defined were not removed because of the errors above.');
    expect(lines[lines.length - 1]).toBe('Errors: 1.');
  });
});
