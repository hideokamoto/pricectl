import { decideRemovalApproval } from '../engine/removal-approval';

describe('decideRemovalApproval', () => {
  it('needs no approval when nothing will be removed', () => {
    expect(decideRemovalApproval({ removalCount: 0, force: false, interactive: false })).toBe('none');
  });

  it('proceeds without asking when --force is given', () => {
    expect(decideRemovalApproval({ removalCount: 2, force: true, interactive: true })).toBe('proceed');
  });

  it('asks for confirmation in an interactive terminal', () => {
    expect(decideRemovalApproval({ removalCount: 2, force: false, interactive: true })).toBe('confirm');
  });

  it('refuses when nobody can be asked and --force is not given', () => {
    expect(decideRemovalApproval({ removalCount: 2, force: false, interactive: false })).toBe('refuse');
  });
});
