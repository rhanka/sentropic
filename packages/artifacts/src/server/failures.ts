/** Trusted server failures (r2 E1–E3). No driver text participates in classification. */
export type ArtifactCommitState = 'not_committed' | 'committed' | 'unknown';
export type ArtifactErrorKind =
  | 'provider_unavailable' | 'command_conflict' | 'pointer_conflict'
  | 'unauthorized_at_commit' | 'capability_unselected' | 'admission_unavailable'
  | 'invalid_request' | 'anonymous' | 'access_denied' | 'not_found' | 'gone' | 'verification_failed';
export type ArtifactFailureCategory =
  | Exclude<ArtifactErrorKind, 'command_conflict' | 'pointer_conflict'> | 'conflict' | 'provider_error';

export interface ArtifactFailure {
  readonly category: ArtifactFailureCategory;
  readonly httpStatus: number;
  readonly publicCode: string;
  readonly retriable: boolean;
  readonly invocationId: string;
  readonly operation: string;
  readonly phase: string;
  readonly commitState: ArtifactCommitState;
  /** Original thrown value, retained by identity and deliberately non-enumerable. */
  readonly cause: unknown;
}

export type ArtifactOutcome<T> =
  | { readonly ok: true; readonly result: T; readonly invocationId: string;
      readonly commitState: ArtifactCommitState; readonly replayed: boolean }
  | { readonly ok: false; readonly failure: ArtifactFailure };

/** State is supplied by the coordinator, never guessed from an error message. */
export interface ArtifactFailureContext {
  readonly invocationId: string;
  readonly operation: string;
  readonly phase: string;
  readonly commitState: ArtifactCommitState;
  readonly storageScopeId?: string;
  readonly operationKey?: string;
}

/** Trusted guard's public refusal; private driver data must never populate these fields. */
export interface ArtifactPublicRefusal {
  readonly status: number;
  readonly publicCode: string;
  readonly retriable: boolean;
}

export class ArtifactOperationError extends Error {
  constructor(
    readonly kind: ArtifactErrorKind,
    readonly details: { readonly cause?: unknown; readonly refusal?: ArtifactPublicRefusal } = {},
  ) {
    super(kind, { cause: details.cause });
    this.name = 'ArtifactOperationError';
  }
}

/** Mint only at verified per-key row contention, using the full scoped operation key. */
export class ArtifactKeyLockConflict extends Error {
  constructor(readonly storageScopeId: string, readonly operationKey: string, cause: unknown) {
    super('artifact key lock contention', { cause });
    this.name = 'ArtifactKeyLockConflict';
  }
}

/** Host wrappers map their own typed errors here; artifacts imports no host error classes. */
export type ArtifactHostFailureMapper = (cause: unknown) => ArtifactOperationError | undefined;

const UNAVAILABLE_CODES = new Set([
  'artifact_connection_lost', '57P06', '55P03', 'lock_timeout', '40001', '40P01', '57014',
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
  'ENOTFOUND', 'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
]);
const TIMEOUT_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutError']);
const DOMAIN_STATUS = {
  invalid_request: 400, anonymous: 401, access_denied: 403,
  not_found: 404, gone: 410, verification_failed: 422,
} as const;

function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  // Unknown thrown objects can have getters; inspection must not replace the original failure.
  try { return (value as Record<string, unknown>)[name]; } catch { return undefined; }
}

function chain(cause: unknown): unknown[] {
  const seen = new Set<unknown>();
  const values: unknown[] = [];
  for (let current = cause; current !== undefined && !seen.has(current); current = field(current, 'cause')) {
    seen.add(current);
    values.push(current);
  }
  return values;
}
