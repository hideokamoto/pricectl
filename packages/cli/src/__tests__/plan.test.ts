import { changedItems, operationOf, Plan, PlanItem, refusals, removals, renameWarnings } from '../engine/plan';

const item = (overrides: Partial<PlanItem>): PlanItem => ({
  id: 'X',
  path: 'Shop/X',
  type: 'Stripe::Price',
  operation: 'unchanged',
  steps: [],
  ...overrides,
});

const planOf = (...items: PlanItem[]): Plan => ({ stackId: 'Shop', items });

describe('operationOf', () => {
  it('is unchanged without steps', () => {
    expect(operationOf([])).toBe('unchanged');
  });

  it('is create when a step creates an object, even if others update', () => {
    expect(operationOf([{ kind: 'create', params: {} as never }, { kind: 'archive', priceId: 'price_1' }])).toBe('create');
  });

  it('is update when steps only change existing objects', () => {
    expect(operationOf([{ kind: 'archive', priceId: 'price_1' }])).toBe('update');
  });
});

describe('plan queries', () => {
  const plan = planOf(
    item({ id: 'A', operation: 'unchanged' }),
    item({ id: 'B', operation: 'update' }),
    item({ id: 'C', operation: 'unchanged', refusal: 'no' }),
    item({ id: 'D', operation: 'remove' }),
  );

  it('lists the items that change something or are refused', () => {
    expect(changedItems(plan).map((i) => i.id)).toEqual(['B', 'C', 'D']);
  });

  it('lists the refusals', () => {
    expect(refusals(plan)).toEqual(['no']);
  });

  it('lists the removals, which need approval', () => {
    expect(removals(plan).map((i) => i.id)).toEqual(['D']);
  });
});

describe('renameWarnings', () => {
  it('warns when a new resource and a removed resource of one type appear together', () => {
    const plan = planOf(
      item({ id: 'ProMonthly', path: 'Shop/ProMonthly', operation: 'create' }),
      item({ id: 'Shop_Monthly', path: 'Shop_Monthly', operation: 'remove' }),
    );

    expect(renameWarnings(plan)).toEqual([
      'Stripe::Price: "Shop/ProMonthly" is new and "Shop_Monthly" is removed in the same deploy. ' +
        'If this is a rename, the Stripe object is replaced: logical IDs and lookup keys are permanent.',
    ]);
  });

  it('does not warn for a resource that replaces an existing object', () => {
    const plan = planOf(
      item({ id: 'Monthly', operation: 'create', physicalId: 'price_1' }),
      item({ id: 'Shop_Old', operation: 'remove' }),
    );

    expect(renameWarnings(plan)).toEqual([]);
  });

  it('does not warn when the new and the removed resource are of different types', () => {
    const plan = planOf(item({ id: 'Pro', type: 'Stripe::Product', operation: 'create' }), item({ id: 'Shop_Old', operation: 'remove' }));

    expect(renameWarnings(plan)).toEqual([]);
  });
});
