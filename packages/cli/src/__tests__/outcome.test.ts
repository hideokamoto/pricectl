import { deployOutcome, destroyOutcome } from '../engine/outcome';

describe('deployOutcome', () => {
  it('reports a deploy without errors as completed', () => {
    const outcome = deployOutcome({
      stackId: 'S',
      deployed: [{ id: 'P', type: 'Stripe::Product', physicalId: 'prod_1', status: 'created' }],
      errors: [],
    });

    expect(outcome).toEqual({ headline: '✓ Deployment completed', failed: false });
  });

  it('fails a deploy that had errors and does not report it as completed', () => {
    const outcome = deployOutcome({
      stackId: 'S',
      deployed: [{ id: 'P', type: 'Stripe::Product', physicalId: 'prod_1', status: 'created' }],
      errors: [{ id: 'Q', type: 'Stripe::Price', error: 'boom' }],
    });

    expect(outcome).toEqual({ headline: '✗ Deployment finished with errors', failed: true });
  });
});

describe('destroyOutcome', () => {
  it('reports a destroy without errors as completed', () => {
    const outcome = destroyOutcome({
      stackId: 'S',
      destroyed: [{ id: 'P', type: 'Stripe::Product', status: 'deleted' }],
      errors: [],
    });

    expect(outcome).toEqual({ headline: '✓ Destruction completed', failed: false });
  });

  it('fails a destroy that had errors', () => {
    const outcome = destroyOutcome({
      stackId: 'S',
      destroyed: [],
      errors: [{ id: 'P', type: 'Stripe::Product', error: 'boom' }],
    });

    expect(outcome).toEqual({ headline: '✗ Destruction finished with errors', failed: true });
  });
});
