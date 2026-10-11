/** What deploy has to do before removing resources that are no longer defined. */
export type RemovalApproval =
  /** Nothing will be removed */
  | 'none'
  /** Removal was approved up front with --force */
  | 'proceed'
  /** Ask the user to confirm */
  | 'confirm'
  /** Nobody can be asked (no interactive terminal) and --force was not given */
  | 'refuse';

/** Decide how deploy gets approval for removing resources that are no longer defined. */
export function decideRemovalApproval(options: {
  removalCount: number;
  force: boolean;
  interactive: boolean;
}): RemovalApproval {
  if (options.removalCount === 0) return 'none';
  if (options.force) return 'proceed';
  return options.interactive ? 'confirm' : 'refuse';
}
