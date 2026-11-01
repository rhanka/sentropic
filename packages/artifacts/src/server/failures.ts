/** Trusted server failures (r2 E1–E3). No driver text participates in classification. */
export type ArtifactCommitState = 'not_committed' | 'committed' | 'unknown';
/** Structurally identical to L0's server-derived SHA-256 internal key, never a caller key. */
export type ArtifactInternalKey = string & { readonly __brand: 'internal-key' };
export type ArtifactErrorKind =
  | 'provider_unavailable' | 'command_conflict' | 'pointer_conflict'
  | 'unauthorized_at_commit' | 'capability_unselected' | 'admission_unavailable'
  | 'invalid_request' | 'anonymous' | 'access_denied' | 'not_found' | 'gone' | 'unprocessable' | 'verification_failed';
export type ArtifactFailureCategory = ArtifactFailure['category'];

interface ArtifactFailureFields {
  readonly details?: Readonly<Record<string, unknown>>;
  readonly variant?: string;
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

export interface ArtifactOperationalFailure extends ArtifactFailureFields {
  readonly kind: 'operational';
  readonly category: 'capability_unselected' | 'provider_unavailable' | 'conflict' | 'unauthorized_at_commit' | 'provider_error';
}

export interface ArtifactOrdinaryFailure extends Omit<ArtifactFailureFields, 'variant' | 'retriable'> {
  readonly kind: 'ordinary';
  readonly category: 'invalid_request' | 'not_found' | 'gone' | 'unprocessable' | 'verification_failed';
  readonly retriable: false;
}

/** Entry authority outcomes are separate from ordinary and operational failures. */
export interface ArtifactAdmissionFailure extends ArtifactFailureFields {
  readonly kind: 'admission';
  readonly category: 'admission_unavailable' | 'anonymous' | 'access_denied';
}

export type ArtifactFailure = ArtifactOperationalFailure | ArtifactOrdinaryFailure | ArtifactAdmissionFailure;

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
  readonly operationKey?: ArtifactInternalKey;
}

/** Trusted guard's public refusal; private driver data must never populate these fields. */
export interface ArtifactPublicRefusal {
  readonly allowed: false;
  readonly reason: 'denied' | 'revoked' | 'expired' | 'invalid_object' | 'unavailable';
  readonly status: number;
  readonly publicCode: string;
  readonly retriable: boolean;
}

export class ArtifactOperationError extends Error {
  constructor(
    readonly kind: ArtifactErrorKind,
    readonly details: { readonly cause?: unknown; readonly refusal?: ArtifactPublicRefusal;
      readonly publicDetails?: Readonly<Record<string, unknown>> } = {},
  ) {
    super(kind, { cause: details.cause });
    this.name = 'ArtifactOperationError';
  }
}

/** Mint only at verified per-key row contention, using the full scoped operation key. */
export class ArtifactKeyLockConflict extends Error {
  constructor(readonly storageScopeId: string, readonly operationKey: ArtifactInternalKey, cause: unknown) {
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
  not_found: 404, gone: 410, unprocessable: 422, verification_failed: 422,
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

type FailureProjection<T> = T extends ArtifactFailure
  ? Omit<T, 'invocationId' | 'operation' | 'phase' | 'commitState' | 'cause'> : never;
type Projection = FailureProjection<ArtifactFailure>;
const unavailable = (category: 'provider_unavailable' | 'admission_unavailable' = 'provider_unavailable'): Projection => {
  const fields = { httpStatus: 503, publicCode: 'capability_unavailable', retriable: true };
  return category === 'admission_unavailable'
    ? { ...fields, kind: 'admission', category, variant: 'entry_outage' }
    : { ...fields, kind: 'operational', category, variant: 'dispatch_failure' };
};
const conflict = (variant = 'key_contention'): Projection => ({ kind: 'operational', category: 'conflict', variant, httpStatus: 409, publicCode: 'conflict', retriable: false });
const internal = (): Projection => ({ kind: 'operational', category: 'provider_error', variant: 'unclassified', httpStatus: 500, publicCode: 'internal_error', retriable: false });

function operationProjection(error: ArtifactOperationError): Projection {
  const { kind } = error;
  switch (kind) {
    case 'provider_unavailable': case 'admission_unavailable': return unavailable(kind);
    case 'command_conflict': case 'pointer_conflict': return conflict(kind);
    case 'capability_unselected': return {
      kind: 'operational', category: kind, variant: 'unselected_operation',
      httpStatus: 503, publicCode: 'capability_unavailable', retriable: false,
    };
    case 'unauthorized_at_commit': {
      const refusal = error.details.refusal ?? { allowed: false, reason: 'denied', status: 403, publicCode: 'access_denied', retriable: false };
      // Stable host-approved codes only; a malformed mapping never exposes its text.
      if (!Number.isInteger(refusal.status) || refusal.status < 400 || refusal.status > 599
        || !/^[a-z][a-z0-9_]{0,63}$/.test(refusal.publicCode)) return internal();
      const authorityUnavailable = refusal.reason === 'unavailable' && refusal.status === 503;
      return {
        kind: 'operational', category: kind, httpStatus: refusal.status,
        variant: authorityUnavailable ? 'authority_unavailable' : 'policy_denial',
        publicCode: refusal.status === 503 ? 'capability_unavailable' : refusal.publicCode,
        retriable: authorityUnavailable,
      };
    }
    case 'anonymous': case 'access_denied':
      return { kind: 'admission', category: kind, httpStatus: DOMAIN_STATUS[kind], publicCode: kind, retriable: false };
    default: return { kind: 'ordinary', category: kind, httpStatus: DOMAIN_STATUS[kind], publicCode: kind, retriable: false };
  }
}

function classify(cause: unknown, context: ArtifactFailureContext, mapHostError?: ArtifactHostFailureMapper): Projection {
  for (const current of chain(cause)) {
    if (current instanceof ArtifactOperationError) return operationProjection(current);
    if (current instanceof ArtifactKeyLockConflict
      && context.phase === 'lock'
      && /^[a-f0-9]{64}$/.test(current.operationKey)
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
    ...(cause instanceof ArtifactOperationError && cause.details.publicDetails &&
      ['confirmation_required', 'confirmation_invalid', 'confirmation_expired', 'confirmation_stale'].includes(projection.publicCode)
      ? { details: cause.details.publicDetails } : {}),
    phase: context.phase, commitState: context.commitState, cause,
  };
  Object.defineProperty(failure, 'cause', { value: cause, enumerable: false });
  return Object.freeze(failure);
}
