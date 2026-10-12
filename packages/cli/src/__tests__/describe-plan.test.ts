import { describePlan, describeStep } from '../engine/describe-plan';
import { Plan, PlanItem } from '../engine/plan';

const item = (overrides: Partial<PlanItem>): PlanItem => ({
  id: 'Monthly',
  path: 'Shop/Monthly',
  type: 'Stripe::Price',
  operation: 'unchanged',
  steps: [],
  ...overrides,
});

const planOf = (...items: PlanItem[]): Plan => ({ stackId: 'Shop', items });

describe('describeStep', () => {
  it('names the objects a price replacement touches', () => {
    expect(describeStep({ kind: 'create', params: { product: 'Shop_Pro', currency: 'usd', lookup_key: 'Shop_Monthly', transfer_lookup_key: true } })).toBe(
      'create price with lookup key "Shop_Monthly", taking the key over from the current price',
    );
    expect(describeStep({ kind: 'setDefault', productId: 'Shop_Pro', priceId: null })).toBe(
      'make the new price the default price of product Shop_Pro',
    );
    expect(describeStep({ kind: 'setDefault', productId: 'Shop_Pro', priceId: 'price_1' })).toBe(
      'make price price_1 the default price of product Shop_Pro',
    );
    expect(describeStep({ kind: 'unsetDefault', productId: 'Shop_Pro' })).toBe('unset the default price of product Shop_Pro');
    expect(describeStep({ kind: 'archive', priceId: 'price_1' })).toBe('archive price price_1');
  });

  it('lists the fields an in-place update changes', () => {
    expect(describeStep({ kind: 'update', priceId: 'price_1', changes: { nickname: 'x', active: false } })).toBe(
      'update price price_1: nickname, active',
    );
  });

  it('says why a product is archived instead of deleted', () => {
    expect(describeStep({ kind: 'archiveProduct', productId: 'Shop_Pro' })).toBe('archive product Shop_Pro (it has prices)');
  });
});

describe('describePlan', () => {
  it('lists changed resources with their steps and counts the rest', () => {
    const lines = describePlan(
      planOf(
        item({ operation: 'create', steps: [{ kind: 'create', params: { product: 'Shop_Pro', currency: 'usd', lookup_key: 'Shop_Monthly' } }] }),
        item({ id: 'Yearly', path: 'Shop/Yearly', operation: 'unchanged' }),
      ),
    );

    expect(lines).toEqual([
      'Stack: Shop',
      '',
      '  + Shop/Monthly [Stripe::Price]',
      '      create price with lookup key "Shop_Monthly"',
      '',
      'Plan: 1 to create, 0 to update, 0 to remove, 1 unchanged.',
    ]);
  });

  it('says there is nothing to do when everything is up to date', () => {
    expect(describePlan(planOf(item({})))).toEqual(['Stack: Shop', '', 'Nothing to do: Stripe matches the definition.']);
  });

  it('says what the caller wants said when there is nothing to do', () => {
    const lines = describePlan(planOf(item({})), { nothingToDo: 'Nothing to destroy.' });

    expect(lines).toEqual(['Stack: Shop', '', 'Nothing to destroy.']);
  });

  it('marks removals and mentions that they need approval', () => {
    const lines = describePlan(
      planOf(item({ id: 'Shop_Old', path: 'Shop_Old', operation: 'remove', steps: [{ kind: 'archive', priceId: 'price_1' }] })),
    );

    expect(lines).toContain('  - Shop_Old [Stripe::Price]');
    expect(lines).toContain('      archive price price_1');
    expect(lines[lines.length - 1]).toBe('Plan: 0 to create, 0 to update, 1 to remove, 0 unchanged. Removals need approval (--force skips it).');
  });

  it('lists refusals and says nothing is changed', () => {
    const lines = describePlan(planOf(item({ refusal: 'The lookup key "k" is held by price price_x.' })));

    expect(lines).toContain('Refused: nothing will be changed.');
    expect(lines).toContain('  ✗ Shop/Monthly: The lookup key "k" is held by price price_x.');
  });

  it('warns about a likely rename', () => {
    const lines = describePlan(
      planOf(item({ id: 'New', path: 'Shop/New', operation: 'create' }), item({ id: 'Shop_Old', path: 'Shop_Old', operation: 'remove' })),
    );

    expect(lines.some((line) => line.startsWith('Warning: Stripe::Price: "Shop/New" is new and "Shop_Old" is removed'))).toBe(true);
  });
});
