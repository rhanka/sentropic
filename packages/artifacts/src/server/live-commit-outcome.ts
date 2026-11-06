import { ArtifactOperationError } from './failures.js';

/** Mint only after a forge side effect or while reconciling that invocation's durable intent. */
export class LiveCommitUnknownError extends ArtifactOperationError {
  readonly commitState = 'unknown' as const;
  constructor(cause: unknown) {
    const denied = cause instanceof ArtifactOperationError && cause.kind === 'access_denied';
    super(denied ? 'access_denied' : 'git_live_conflict', { cause,
      ...(denied ? {} : { publicDetails: { reason: 'commit_indeterminate' } }) });
  }
}
