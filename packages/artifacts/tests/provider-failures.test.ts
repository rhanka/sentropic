import { describe, expect, expectTypeOf, it } from 'vitest';
import { DERIVATION_VECTORS, type InternalIdempotencyKey } from '../l0-freeze/command-identity-contract.js';
import { FAILURE_PROJECTIONS, ORDINARY_FAILURE_PROJECTIONS, type ArtifactFailure as FrozenFailure,
  type OrdinaryFailure as FrozenOrdinaryFailure,
  type ArtifactOutcome as FrozenOutcome } from '../l0-freeze/failure-contract.js';
import type { ArtifactAuthorizationDecision } from '../l0-freeze/commit-contract.js';
import type { HttpResponse } from '../src/http.js';
import type { ArtifactOperationalFailure, ArtifactOrdinaryFailure, ArtifactOutcome, ArtifactPublicRefusal } from '../src/server/failures.js';

const scopedKey = DERIVATION_VECTORS[0].sha256 as InternalIdempotencyKey;
const storageScopeId = DERIVATION_VECTORS[0].binding.scope;

// Import inside each test so the unchanged L0 baseline fails every vector.
const failures = () => import('../src/server/failures.js');
const projections = () => import('../src/server/outcome-projection.js');
const context: import('../src/server/failures.js').ArtifactFailureContext = {
  invocationId: 'inv-1', operation: 'publish', phase: 'prepare',
  commitState: 'not_committed' as const, storageScopeId, operationKey: scopedKey,
};
const driver = (code: string) => Object.assign(new Error('private SQL endpoint bucket credential'), { code });

async function expectProjection(cause: unknown, expected: Record<string, unknown>, ctx = context) {
  const { classifyArtifactFailure } = await failures();
  const { projectArtifactHttpOutcome, projectArtifactMcpOutcome } = await projections();
  const failure = classifyArtifactFailure(cause, ctx);
  expect(failure).toMatchObject({
    invocationId: ctx.invocationId, operation: ctx.operation, phase: ctx.phase,
    commitState: ctx.commitState, ...expected,
  });
  expect(failure.cause).toBe(cause);
  const outcome = { ok: false as const, failure };
  expect(projectArtifactHttpOutcome(outcome)).toEqual({
    status: failure.httpStatus, body: { error: failure.publicCode },
  });
  const result = projectArtifactMcpOutcome(outcome, 'audit-1');
  expect(result).toEqual({
    ok: false, auditId: 'audit-1', redactionClass: 'low',
    invocationId: ctx.invocationId, commitState: ctx.commitState,
    error: { code: failure.publicCode, message: failure.publicCode, retriable: failure.retriable,
      ...('variant' in failure && failure.variant !== undefined ? { details: { variant: failure.variant } } : {}) },
  });
  expect(JSON.stringify(result)).not.toMatch(/private|credential|bucket|endpoint|stack|cause/);
  return failure;
}

const unavailable = {
  category: 'provider_unavailable', httpStatus: 503, publicCode: 'capability_unavailable', retriable: true,
};
describe('typed provider failures, r2 E2/E3', () => {
  it.each([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH',
    'EAI_AGAIN', 'artifact_connection_lost', '57P06', '08000', '08001', '08003', '08004',
    '08006', '08007', '08P01', '40001', '40P01', '57014',
  ])('should project recognized %s as retriable unavailability on both transports', async (code) => {
    await expectProjection(driver(code), unavailable);
  });

  it.each(['binding', 'artifact', 'lifecycle', 'acl', 'pointer', 'policy', 'quota', 'blob-reference', 'deletion-claim', 'schema', 'infrastructure', 'lock'])
    ('should refuse to mint conflict from unqualified 55P03 at %s', async (phase) => {
      await expectProjection(driver('55P03'), unavailable, { ...context, phase });
    });

  it.each(['lost', 'conflict', 'lock_timeout', 'timeout', 'invalid SQL', 'access denied by driver'])
    ('should sanitize an unrecognized message containing %s without guessing its category', async (message) => {
      await expectProjection(new Error(message), {
        category: 'provider_error', httpStatus: 500, publicCode: 'internal_error', retriable: false,
      });
    });

  it('should retain a nested original connection cause even when the wrapper says lost', async () => {
    const inner = driver('57P06');
    const cause = new Error('artifact connection lost', { cause: inner });
    const failure = await expectProjection(cause, unavailable);
    expect((failure.cause as Error).cause).toBe(inner);
  });

  it('should retain a cyclic cause chain without looping', async () => {
    const cause = Object.assign(new Error('private'), { cause: undefined as unknown });
    cause.cause = cause;
    await expectProjection(cause, { category: 'provider_error', retriable: false });
  });
});

describe('trusted domain and adapter mappings', () => {
  it.each(FAILURE_PROJECTIONS)('should consume frozen outcome variant $variant with matching ledger semantics', async (row) => {
    const { ArtifactOperationError, ArtifactKeyLockConflict } = await failures();
    const { projectArtifactWriteFailure } = await projections();
    const cause = row.category === 'conflict' ? new ArtifactKeyLockConflict(storageScopeId, scopedKey, driver('55P03'))
      : row.category === 'unauthorized_at_commit' ? new ArtifactOperationError(row.category, {
        refusal: { allowed: false, reason: row.variant === 'authority_unavailable' ? 'unavailable' : 'denied',
          status: row.httpStatus, publicCode: row.publicCode, retriable: row.retriable },
      }) : row.category === 'provider_error' ? new Error('private') : new ArtifactOperationError(row.category);
    const failure = await expectProjection(cause, {
      kind: 'operational', category: row.category, variant: row.variant, httpStatus: row.httpStatus,
      publicCode: row.publicCode, retriable: row.retriable,
    }, { ...context, phase: row.phase, commitState: row.commitState });
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })?.reason).toBe(row.radarLedgerReason);
  });

  it('should preserve a typed policy denial even when its sanitized status is 503', async () => {
    const { ArtifactOperationError } = await failures();
    const refusal: Extract<ArtifactAuthorizationDecision, { allowed: false }> = {
      allowed: false, reason: 'revoked', status: 503, publicCode: 'access_denied', retriable: true,
    };
    await expectProjection(new ArtifactOperationError('unauthorized_at_commit', { refusal }), {
      category: 'unauthorized_at_commit', retriable: false,
    }, { ...context, phase: 'guard' });
  });

  it('should consume frozen guard and outcome declarations without losing fields', () => {
    expectTypeOf<ArtifactPublicRefusal>().toEqualTypeOf<Extract<ArtifactAuthorizationDecision, { allowed: false }>>();
    expectTypeOf<ArtifactOperationalFailure>().toEqualTypeOf<FrozenFailure>();
    expectTypeOf<ArtifactOrdinaryFailure>().toEqualTypeOf<FrozenOrdinaryFailure>();
    expectTypeOf<FrozenOutcome<HttpResponse>>().toExtend<ArtifactOutcome<HttpResponse>>();
  });

  it.each(ORDINARY_FAILURE_PROJECTIONS)('should project frozen ordinary $category without write accounting', async (row) => {
    const { ArtifactOperationError } = await failures();
    const { projectArtifactWriteFailure } = await projections();
    const failure = await expectProjection(new ArtifactOperationError(row.category), {
      ...row, kind: 'ordinary',
    }, { ...context, phase: row.phase, commitState: row.commitState });
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toBeUndefined();
  });

  it.each(['anonymous', 'access_denied', 'admission_unavailable'] as const)
    ('should keep %s in the admission branch without write accounting', async (kind) => {
      const { ArtifactOperationError } = await failures();
      const { projectArtifactWriteFailure } = await projections();
      const failure = await expectProjection(new ArtifactOperationError(kind), { kind: 'admission' });
      expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toBeUndefined();
    });

  it('should consume the frozen L0 key-lock phase and full derived identity', async () => {
    const { FINALIZATION_PHASES } = await import('../l0-freeze/commit-contract.js');
    const { ArtifactKeyLockConflict } = await failures();
    const operationKey = scopedKey;
    const scope = DERIVATION_VECTORS[0].binding.scope;
    const phase = FINALIZATION_PHASES.find((value) => value === 'lock')!;
    await expectProjection(new ArtifactKeyLockConflict(scope, operationKey, driver('55P03')), {
      category: 'conflict', httpStatus: 409, retriable: false,
    }, { ...context, storageScopeId: scope, operationKey, phase });
  });

  it.each(['key-1', scopedKey.slice(0, 16)])
    ('should reject caller or truncated key %s even when both proof fields agree', async (key) => {
      const { ArtifactKeyLockConflict } = await failures();
      const operationKey = key as InternalIdempotencyKey;
      await expectProjection(new ArtifactKeyLockConflict(storageScopeId, operationKey, driver('55P03')), unavailable,
        { ...context, operationKey, phase: 'lock' });
    });

  it('should accept only the frozen internal-key brand at the trusted contention seam', async () => {
    const { ArtifactKeyLockConflict } = await failures();
    expectTypeOf<ConstructorParameters<typeof ArtifactKeyLockConflict>[1]>().toEqualTypeOf<InternalIdempotencyKey>();
  });

  it('should exclude frozen L0 admission failures from dispatched-write accounting', async () => {
    const { FINALIZATION_PHASES } = await import('../l0-freeze/commit-contract.js');
    const { classifyArtifactFailure } = await failures();
    const { projectArtifactWriteFailure } = await projections();
    const phase = FINALIZATION_PHASES.find((value) => value === 'admit')!;
    const failure = classifyArtifactFailure(driver('57P06'), { ...context, phase });
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toBeUndefined();
  });

  it.each(['TimeoutError', 'RequestTimeout', 'RequestTimeoutError'])
    ('should classify an S3 request/body-stream %s without inspecting its message', async (name) => {
      await expectProjection(Object.assign(new Error('private'), { name }), unavailable);
    });

  it('should qualify 55P03 only for the same full key, scope and key-lock phase', async () => {
    const { ArtifactKeyLockConflict } = await failures();
    const original = driver('55P03');
    const cause = new ArtifactKeyLockConflict(storageScopeId, scopedKey, original);
    const failure = await expectProjection(cause, {
      category: 'conflict', httpStatus: 409, publicCode: 'conflict', retriable: false,
    }, { ...context, phase: 'lock' });
    expect((failure.cause as Error).cause).toBe(original);
  });

  it.each([
    ['scope-2', scopedKey, 'lock'], [storageScopeId, DERIVATION_VECTORS[2].sha256, 'lock'],
    [storageScopeId, scopedKey.slice(0, 16), 'lock'], [storageScopeId, scopedKey, 'policy'],
  ])('should reject conflict qualification for scope %s key %s phase %s', async (scope, key, phase) => {
    const { ArtifactKeyLockConflict } = await failures();
    await expectProjection(new ArtifactKeyLockConflict(scope, key as InternalIdempotencyKey, driver('55P03')), unavailable, { ...context, phase });
  });

  it.each(['command_conflict', 'pointer_conflict'] as const)
    ('should retain a verified %s as non-retriable conflict', async (kind) => {
      const { ArtifactOperationError } = await failures();
      await expectProjection(new ArtifactOperationError(kind, { cause: driver('private') }), {
        category: 'conflict', httpStatus: 409, publicCode: 'conflict', retriable: false,
      });
    });

  it.each([
    ['invalid_request', 400], ['anonymous', 401], ['access_denied', 403],
    ['not_found', 404], ['gone', 410], ['verification_failed', 422],
  ] as const)('should preserve the ordinary typed %s mapping', async (kind, status) => {
    const { ArtifactOperationError } = await failures();
    await expectProjection(new ArtifactOperationError(kind), {
      httpStatus: status, publicCode: kind, retriable: false,
    });
  });

  it.each([
    [401, 'anonymous', true], [404, 'not_found', true], [410, 'gone', true],
    [403, 'activation_closed', false], [503, 'capability_unavailable', true],
    [503, 'capability_unavailable', false],
    [503, 'host_outage', false],
    [403, 'not_in_cohort', true],
  ] as const)('should preserve refusal %s/%s with host retry %s and normative outage semantics', async (status, publicCode, retriable) => {
    const { ArtifactOperationError } = await failures();
    const failure = await expectProjection(new ArtifactOperationError('unauthorized_at_commit', {
      cause: driver('private'), refusal: { allowed: false, reason: status === 503 ? 'unavailable' : 'denied', status, publicCode, retriable },
    }), {
      category: 'unauthorized_at_commit', httpStatus: status,
      publicCode: status === 503 ? 'capability_unavailable' : publicCode,
      retriable: status === 503,
    }, { ...context, phase: 'guard' });
    const { projectArtifactMcpOutcome } = await projections();
    const { encodeToolResult } = await import('@sentropic/mcp-platform/transport/result-codec');
    const wire = encodeToolResult(projectArtifactMcpOutcome({ ok: false, failure }, 'audit-guard'));
    expect(wire.isError).toBe(true);
    expect(wire._meta).toMatchObject({
      errorCode: status === 503 ? 'capability_unavailable' : publicCode, retriable: status === 503,
    });
  });

  it('should make an unselected capability unavailable without retry', async () => {
    const { ArtifactOperationError } = await failures();
    await expectProjection(new ArtifactOperationError('capability_unselected'), {
      category: 'capability_unselected', httpStatus: 503, publicCode: 'capability_unavailable', retriable: false,
    }, { ...context, phase: 'selection' });
  });

  it('should map external typed wrappers through a trusted host seam and retain the wrapper', async () => {
    const { ArtifactOperationError, classifyArtifactFailure } = await failures();
    class HostPoolTimeout extends Error {}
    const cause = new HostPoolTimeout('private host connection');
    const mapHostError = (error: unknown) => error instanceof HostPoolTimeout
      ? new ArtifactOperationError('provider_unavailable') : undefined;
    expect(classifyArtifactFailure(cause, context, mapHostError)).toMatchObject({ ...unavailable, cause });
    expect(classifyArtifactFailure(new Error('private host connection'), context, mapHostError).category).toBe('provider_error');
  });
});

describe('outcome correlation, commit state and privacy', () => {
  it('should supply one correlated ledger descriptor for a dispatched write, with no mutable recording', async () => {
    const { classifyArtifactFailure } = await failures();
    const { projectArtifactWriteFailure } = await projections();
    const failure = classifyArtifactFailure(driver('57P06'), context);
    const expected = { invocationId: 'inv-1', operation: 'publish', reason: 'provider_unavailable', status: 503 };
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toEqual(expected);
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toEqual(expected);
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: false })).toBeUndefined();
    expect(projectArtifactWriteFailure(failure, { dispatched: false, write: true })).toBeUndefined();
  });

  it.each(['capability_unselected', 'admission_unavailable'] as const)
    ('should exclude %s entry refusal from write-commit accounting', async (kind) => {
      const { ArtifactOperationError, classifyArtifactFailure } = await failures();
      const { projectArtifactWriteFailure } = await projections();
      const failure = classifyArtifactFailure(new ArtifactOperationError(kind), { ...context, phase: 'admit' });
      expect(projectArtifactWriteFailure(failure, { dispatched: true, write: true })).toBeUndefined();
    });

  it('should keep a read connection failure unavailable without a write-ledger entry', async () => {
    const { projectArtifactWriteFailure } = await projections();
    const failure = await expectProjection(driver('57P06'), unavailable, { ...context, operation: 'get' });
    expect(projectArtifactWriteFailure(failure, { dispatched: true, write: false })).toBeUndefined();
  });
  it.each(['artifact_connection_lost', '57014', 'ETIMEDOUT', '55P03'])
    ('should preserve uncertainty for %s around an unacknowledged COMMIT', async (code) => {
      await expectProjection(driver(code), { ...unavailable, commitState: 'unknown' }, {
        ...context, phase: 'commit', commitState: 'unknown',
      });
    });

  it('should preserve a proven abort without losing the primary cause on cleanup failure', async () => {
    const { classifyArtifactFailure } = await failures();
    const primary = driver('40001');
    const failure = classifyArtifactFailure(primary, { ...context, phase: 'rollback' });
    classifyArtifactFailure(new Error('cleanup failed'), { ...context, invocationId: 'cleanup' });
    expect(failure).toMatchObject({ ...unavailable, commitState: 'not_committed', cause: primary });
  });

  it('should keep a post-commit monitoring outage committed', async () => {
    const { ArtifactOperationError } = await failures();
    await expectProjection(new ArtifactOperationError('unauthorized_at_commit'), {
      ...unavailable, commitState: 'committed',
    }, { ...context, phase: 'monitoring', commitState: 'committed' });
  });

  it('should isolate concurrent invocations with different failures', async () => {
    const { ArtifactOperationError, classifyArtifactFailure } = await failures();
    const causes = [driver('57P06'), new ArtifactOperationError('command_conflict')];
    const results = await Promise.all(causes.map(async (cause, index) => {
      await Promise.resolve();
      return classifyArtifactFailure(cause, { ...context, invocationId: `inv-${index}` });
    }));
    expect(results.map((failure) => [failure.invocationId, failure.category, failure.cause])).toEqual([
      ['inv-0', 'provider_unavailable', causes[0]], ['inv-1', 'conflict', causes[1]],
    ]);
  });

  it('should keep private causes out of JSON even before wire projection', async () => {
    const { classifyArtifactFailure } = await failures();
    const failure = classifyArtifactFailure(driver('57P06'), context);
    expect(JSON.stringify(failure)).not.toMatch(/private|credential|bucket|endpoint|stack|cause/);
    expect(Object.getOwnPropertyDescriptor(failure, 'cause')?.enumerable).toBe(false);
  });

  it('should redact every MCP wire field using the existing platform codec', async () => {
    const { classifyArtifactFailure } = await failures();
    const { projectArtifactMcpOutcome } = await projections();
    const { encodeToolResult, decodeToolResult } = await import('@sentropic/mcp-platform/transport/result-codec');
    const failure = classifyArtifactFailure(driver('ETIMEDOUT'), context);
    const result = projectArtifactMcpOutcome({ ok: false, failure }, 'audit-1');
    const wire = encodeToolResult(result);
    expect(wire.isError).toBe(true);
    expect(wire._meta).toMatchObject({ errorCode: 'capability_unavailable', retriable: true });
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toEqual({
      ok: false, invocationId: 'inv-1', commitState: 'not_committed',
      error: { code: 'capability_unavailable', message: 'capability_unavailable', retriable: true,
        details: { variant: 'dispatch_failure' } },
    });
    expect(JSON.stringify(wire)).not.toMatch(/private|credential|bucket|endpoint|stack|cause/);
    expect(decodeToolResult(wire)).toEqual(result);
  });

  it('should pass successes through with their receipt and replay metadata intact', async () => {
    const { projectArtifactHttpOutcome, projectArtifactMcpOutcome } = await projections();
    const result = { status: 201, body: { artifactId: 'a', releaseId: 'r', digest: 'd', stableUrl: '/a', pinnedUrl: '/r' } };
    const outcome = { ok: true as const, result, invocationId: 'inv-1', commitState: 'committed' as const, replayed: true };
    expect(projectArtifactHttpOutcome(outcome)).toBe(result);
    expect(projectArtifactMcpOutcome(outcome, 'audit-1')).toEqual({
      ok: true, output: result.body, auditId: 'audit-1', redactionClass: 'low',
      invocationId: 'inv-1', commitState: 'committed', replayed: true,
    });
    expect(result.body).not.toHaveProperty('replayed');
  });
});
