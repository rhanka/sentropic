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

type Projection = Pick<ArtifactFailure, 'category' | 'httpStatus' | 'publicCode' | 'retriable'>;
const unavailable = (category: 'provider_unavailable' | 'admission_unavailable' = 'provider_unavailable'): Projection => ({
  category, httpStatus: 503, publicCode: 'capability_unavailable', retriable: true,
});
const conflict = (): Projection => ({ category: 'conflict', httpStatus: 409, publicCode: 'conflict', retriable: false });
const internal = (): Projection => ({ category: 'provider_error', httpStatus: 500, publicCode: 'internal_error', retriable: false });

function operationProjection(error: ArtifactOperationError): Projection {
  const { kind } = error;
  switch (kind) {
    case 'provider_unavailable': case 'admission_unavailable': return unavailable(kind);
    case 'command_conflict': case 'pointer_conflict': return conflict();
    case 'capability_unselected': return { ...unavailable(), category: kind, retriable: false };
    case 'unauthorized_at_commit': {
      const refusal = error.details.refusal ?? { status: 403, publicCode: 'access_denied', retriable: false };
      // Stable host-approved codes only; a malformed mapping never exposes its text.
      if (!Number.isInteger(refusal.status) || refusal.status < 400 || refusal.status > 599
        || !/^[a-z][a-z0-9_]{0,63}$/.test(refusal.publicCode)) return internal();
      return {
        category: kind, httpStatus: refusal.status,
        publicCode: refusal.status === 503 ? 'capability_unavailable' : refusal.publicCode,
        retriable: refusal.status === 503 ? true : refusal.status === 403 ? false : refusal.retriable,
      };
    }
    default: return { category: kind, httpStatus: DOMAIN_STATUS[kind], publicCode: kind, retriable: false };
  }
}

function classify(cause: unknown, context: ArtifactFailureContext, mapHostError?: ArtifactHostFailureMapper): Projection {
  for (const current of chain(cause)) {
    if (current instanceof ArtifactOperationError) return operationProjection(current);
    if (current instanceof ArtifactKeyLockConflict
      && context.phase === 'key_lock'
      && context.storageScopeId === current.storageScopeId
      && context.operationKey === current.operationKey) return conflict();
    if (mapHostError !== undefined) {
      try {
        const mapped = mapHostError(current);
        if (mapped instanceof ArtifactOperationError) return operationProjection(mapped);
      } catch { return internal(); }
    }
    const code = field(current, 'code');
    if (typeof code === 'string' && (UNAVAILABLE_CODES.has(code) || /^08[A-Z0-9]{3}$/.test(code))) return unavailable();
    const name = field(current, 'name');
    if (current instanceof Error && typeof name === 'string' && TIMEOUT_NAMES.has(name)) return unavailable();
  }
  return internal();
}

/** Pure per-invocation classification. Cleanup errors must not replace the primary cause. */
export function classifyArtifactFailure(
  cause: unknown,
  context: ArtifactFailureContext,
  mapHostError?: ArtifactHostFailureMapper,
): ArtifactFailure {
  let projection = classify(cause, context, mapHostError);
  // Monitoring after a proven commit cannot become a prevented finalization.
  if (context.commitState === 'committed' && projection.category === 'unauthorized_at_commit') projection = unavailable();
  const failure: ArtifactFailure = {
    ...projection, invocationId: context.invocationId, operation: context.operation,
    phase: context.phase, commitState: context.commitState, cause,
  };
  Object.defineProperty(failure, 'cause', { value: cause, enumerable: false });
  return Object.freeze(failure);
}
