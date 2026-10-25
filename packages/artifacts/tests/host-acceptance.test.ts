import { describe, expect, it, vi } from 'vitest';
import { createTransportWorld } from './fixtures/transport-world.js';
import { createArtifactCommitBarrier } from '../src/testing.js';
import { ArtifactOperationError } from '../src/server/failures.js';
import { projectArtifactHttpOutcome, projectArtifactMcpOutcome } from '../src/server/outcome-projection.js';
import { createArtifactsToolExecutor, createArtifactsAdapter } from '../src/mcp-core.js';
import type { StpConnectorContext } from '@sentropic/mcp-platform';

const publishArgs = (artifactId: string) => ({ artifactId, idempotencyKey: 'publish',
  files: [{ path: 'index.html', mimeType: 'text/html', text: 'hi' }] });
const ensureArtifact = async (host: ReturnType<typeof createTransportWorld>) => {
  const outcome = await host.http('/ensure', { bindingName: 'site', idempotencyKey: 'ensure' });
  if (!outcome.ok) throw new Error('ensure failed');
  return (outcome.result.body as { artifactId: string }).artifactId;
};
const mapHostError = (cause: unknown) => (cause as { code?: string })?.code === 'artifact_s3_timeout'
  ? new ArtifactOperationError('provider_unavailable', { cause }) : undefined;

describe('Radar 0.2.1 acceptance regressions', () => {
  it('should map failures thrown by MCP host bindings and app delegates', async () => {
    const host = createTransportWorld();
    const cause = Object.assign(new Error('private host failure'), { code: 'artifact_s3_timeout' });
    const app = { ...host.app, async execute() { throw cause; } };
    const executor = createArtifactsToolExecutor({ app, profile: host.profile, mapHostError });
    const args = { bindingName: 'site', idempotencyKey: 'ensure' };
    const outcome = await executor.execute({ tool: 'artifacts_ensure', args, invocation: host.invocation() });
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'provider_unavailable', retriable: true } });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.failure.cause).toBe(cause);
    const adapter = createArtifactsAdapter({ app, profile: host.profile, mapHostError,
      createInvocation() { throw cause; } });
    const ctx = { requestId: 'request', auditId: 'audit', principal: { sub: 'alice' } } as StpConnectorContext;
    const projected = await adapter.invokeTool({ capabilityRef: 'artifacts_ensure', input: args, ctx });
    expect(projected).toMatchObject({ ok: false, error: { code: 'capability_unavailable', retriable: true } });
    expect(JSON.stringify(projected)).not.toContain(cause.message);
  });
  it.each(['http', 'mcp'] as const)('should call host authorization after suspension at the %s finalization barrier', async (transport) => {
    const barrier = createArtifactCommitBarrier({ points: ['before_finalization_row_lock'] });
    const host = createTransportWorld(undefined, undefined, { testObserver: barrier.observer });
    const initial = host.invocation();
    const ensured = host.http('/ensure', { bindingName: 'site', idempotencyKey: 'ensure' }, initial);
    await barrier.waitUntilReached('before_finalization_row_lock', initial.invocationId);
    barrier.release('before_finalization_row_lock', initial.invocationId);
    const first = await ensured;
    if (!first.ok) throw new Error('ensure failed');
    const args = publishArgs((first.result.body as { artifactId: string }).artifactId);
    const authorizeCommit = vi.fn(async (context, transaction) => {
      expect(context.purpose).toBe('finalize');
      expect(await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation }))
        .toEqual({ approved: false });
      return { allowed: false as const, reason: 'denied' as const, status: 403,
        publicCode: 'account_not_approved', retriable: false };
    });
    const invocation = { ...host.invocation(), authorizeCommit };
    const pending = transport === 'http' ? host.http('/publish', args, invocation)
      : host.mcp.execute({ tool: 'artifacts_publish', args, invocation });
    await barrier.waitUntilReached('before_finalization_row_lock', invocation.invocationId);
    host.suspend();
    barrier.release('before_finalization_row_lock', invocation.invocationId);
    const outcome = await pending;
    expect(authorizeCommit).toHaveBeenCalledOnce();
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit',
      publicCode: 'account_not_approved', httpStatus: 403, commitState: 'not_committed' } });
    expect(projectArtifactHttpOutcome(outcome)).toEqual({ status: 403, body: { error: 'account_not_approved' } });
    expect(host.releases.size).toBe(0);
    expect(host.receipts.size).toBe(1);
    expect(await host.publication.getCurrent(args.artifactId)).toBeUndefined();
  });

  it.each(['http', 'mcp'] as const)('should map a host S3 timeout below %s to retriable unavailability', async (transport) => {
    const host = createTransportWorld(undefined, undefined, { mapHostError });
    const args = publishArgs(await ensureArtifact(host));
    const cause = Object.assign(new Error('private S3 endpoint and credentials'), { code: 'artifact_s3_timeout' });
    vi.spyOn(host.blobs, 'putBlob').mockRejectedValueOnce(cause);
    const outcome = transport === 'http' ? await host.http('/publish', args)
      : await host.mcp.execute({ tool: 'artifacts_publish', args, invocation: host.invocation() });
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'provider_unavailable',
      retriable: true, commitState: 'not_committed' } });
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.failure.cause).toBe(cause);
    expect(projectArtifactHttpOutcome(outcome)).toEqual({ status: 503, body: { error: 'capability_unavailable' } });
    expect(projectArtifactMcpOutcome(outcome, 'audit')).toMatchObject({ ok: false,
      error: { code: 'capability_unavailable', retriable: true } });
    expect(JSON.stringify(outcome)).not.toContain(cause.message);
    expect(Object.keys(outcome.failure)).not.toContain('cause');
    expect(JSON.stringify(outcome)).not.toContain('artifact_s3_timeout');
    expect(host.releases.size).toBe(0);
    expect(host.receipts.size).toBe(1);
  });

  it('should apply the host mapper inside the coordinator', async () => {
    const host = createTransportWorld(undefined, undefined, { mapHostError });
    const cause = Object.assign(new Error('private connection timeout'), { code: 'artifact_s3_timeout' });
    vi.spyOn(host.executor, 'beginFinalization').mockRejectedValueOnce(cause);
    expect(await host.http('/ensure', { bindingName: 'site', idempotencyKey: 'ensure' }))
      .toMatchObject({ ok: false, failure: { category: 'provider_unavailable', retriable: true,
        commitState: 'not_committed', phase: 'acquire' } });
    expect(host.receipts.size).toBe(0);
    expect(host.bindings.size).toBe(0);
  });
});
