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

