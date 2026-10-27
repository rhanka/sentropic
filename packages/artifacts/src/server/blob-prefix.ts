import { ArtifactOperationError } from './failures.js';

class InvalidBlobPrefixError extends ArtifactOperationError {
  readonly code = 'invalid_blob_prefix';

  constructor(prefix: string) {
    super('invalid_request');
    this.message = `invalid blob prefix: ${prefix}`;
  }
}

/** Reject empty or escaping prefixes before enumeration or external I/O. */
export function assertBlobPrefix(prefix: string): void {
  if (prefix.length === 0 || prefix.includes('..')) {
    throw new InvalidBlobPrefixError(prefix);
  }
}
