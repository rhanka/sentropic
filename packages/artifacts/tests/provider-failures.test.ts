import { describe, expect, it } from 'vitest';

// Import inside each test so the unchanged L0 baseline fails every vector.
const failures = () => import('../src/server/failures.js');
const projections = () => import('../src/server/outcome-projection.js');
const context: import('../src/server/failures.js').ArtifactFailureContext = {
  invocationId: 'inv-1', operation: 'publish', phase: 'prepare',
  commitState: 'not_committed' as const, storageScopeId: 'scope-1', operationKey: 'full-key-1',
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
    error: { code: failure.publicCode, message: failure.publicCode, retriable: failure.retriable },
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

  it.each(['binding', 'artifact', 'lifecycle', 'acl', 'pointer', 'policy', 'quota', 'blob-reference', 'deletion-claim', 'schema', 'infrastructure', 'key_lock'])
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
  it.each(['TimeoutError', 'RequestTimeout', 'RequestTimeoutError'])
    ('should classify an S3 request/body-stream %s without inspecting its message', async (name) => {
      await expectProjection(Object.assign(new Error('private'), { name }), unavailable);
    });

  it('should qualify 55P03 only for the same full key, scope and key-lock phase', async () => {
    const { ArtifactKeyLockConflict } = await failures();
    const original = driver('55P03');
    const cause = new ArtifactKeyLockConflict('scope-1', 'full-key-1', original);
    const failure = await expectProjection(cause, {
      category: 'conflict', httpStatus: 409, publicCode: 'conflict', retriable: false,
    }, { ...context, phase: 'key_lock' });
    expect((failure.cause as Error).cause).toBe(original);
  });

  it.each([
    ['scope-2', 'full-key-1', 'key_lock'], ['scope-1', 'other-key', 'key_lock'],
    ['scope-1', 'full-key', 'key_lock'], ['scope-1', 'full-key-1', 'policy'],
  ])('should reject conflict qualification for scope %s key %s phase %s', async (scope, key, phase) => {
    const { ArtifactKeyLockConflict } = await failures();
    await expectProjection(new ArtifactKeyLockConflict(scope, key, driver('55P03')), unavailable, { ...context, phase });
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
    [403, 'activation_closed', false], [503, 'capability_unavailable', true],
  ] as const)('should preserve sanitized finalization refusal %s with explicit retry semantics', async (status, publicCode, retriable) => {
    const { ArtifactOperationError } = await failures();
    await expectProjection(new ArtifactOperationError('unauthorized_at_commit', {
      cause: driver('private'), refusal: { status, publicCode, retriable },
    }), { category: 'unauthorized_at_commit', httpStatus: status, publicCode, retriable }, { ...context, phase: 'guard' });
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
      const failure = classifyArtifactFailure(new ArtifactOperationError(kind), { ...context, phase: 'admission' });
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
      code: 'capability_unavailable', message: 'capability_unavailable',
    });
    expect(JSON.stringify(wire)).not.toMatch(/private|credential|bucket|endpoint|stack|cause|inv-1/);
    expect(decodeToolResult(wire)).toEqual(result);
  });

  it('should pass successes through with their receipt and replay metadata intact', async () => {
    const { projectArtifactHttpOutcome, projectArtifactMcpOutcome } = await projections();
    const result = { status: 201, body: { artifactId: 'a', releaseId: 'r', digest: 'd', stableUrl: '/a', pinnedUrl: '/r' } };
    const outcome = { ok: true as const, result, invocationId: 'inv-1', commitState: 'committed' as const, replayed: true };
    expect(projectArtifactHttpOutcome(outcome)).toBe(result);
    expect(projectArtifactMcpOutcome(outcome, 'audit-1')).toEqual({
      ok: true, output: result.body, auditId: 'audit-1', redactionClass: 'low',
    });
    expect(result.body).not.toHaveProperty('replayed');
  });
});
