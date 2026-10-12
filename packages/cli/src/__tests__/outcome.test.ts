import type { ApplyResult } from '../engine/apply-plan';
import { deployOutcome, destroyOutcome } from '../engine/outcome';

const created = { id: 'P', path: 'S/P', type: 'Stripe::Product', operation: 'create' as const, physicalId: 'prod_1' };
const withError = { ...created, id: 'Q', path: 'S/Q', type: 'Stripe::Price', error: 'boom' };

const result = (items: ApplyResult['items']): ApplyResult => ({ stackId: 'S', items, removalSkipped: false });

describe('deployOutcome', () => {
  it('reports a deploy without errors as completed', () => {
    expect(deployOutcome(result([created]))).toEqual({ headline: '✓ Deployment completed', failed: false });
  });

  it('fails a deploy that had errors and does not report it as completed', () => {
    expect(deployOutcome(result([created, withError]))).toEqual({ headline: '✗ Deployment finished with errors', failed: true });
  });
});

describe('destroyOutcome', () => {
  it('reports a destroy without errors as completed', () => {
    expect(destroyOutcome(result([{ ...created, operation: 'remove' }]))).toEqual({ headline: '✓ Destruction completed', failed: false });
  });

  it('fails a destroy that had errors', () => {
    expect(destroyOutcome(result([withError]))).toEqual({ headline: '✗ Destruction finished with errors', failed: true });
  });
});
