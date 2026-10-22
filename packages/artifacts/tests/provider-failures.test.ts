import { describe, expect, it } from 'vitest';

// Import inside each test so the unchanged L0 baseline fails every vector.
const failures = () => import('../src/server/failures.js');
const projections = () => import('../src/server/outcome-projection.js');
const context = {
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
