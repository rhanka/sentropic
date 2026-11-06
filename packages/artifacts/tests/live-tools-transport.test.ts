import { expect, it } from 'vitest';
import { createTransportWorld } from './fixtures/transport-world.js';
import { RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { liveWitness } from './fixtures/live-world.js';
import { LIVE_FAILURE_STATUS } from '../src/server/live-errors.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';
import { LiveCommitUnknownError } from '../src/server/live-commit-outcome.js';

it('should expose the same live status through HTTP and MCP while refusing a missing service', async () => {
  const w = liveWitness();
  const profile = { ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: ['artifacts_live_status'],
    operations: [{ operation: 'live_status', limits: {}, defaults: {} }] };
  const world = createTransportWorld(['alice'], 'scope-a', { profile, live: w.service });
  const args = { artifactId: w.binding.artifactId };
  const http = await world.http('/live_status', args);
  expect(http).toMatchObject({ ok: true, result: { status: 200, body: { dirty: false, runtimeState: 'DORMANT' } } });
  expect(await world.mcp.execute({ tool: 'artifacts_live_status', args, invocation: world.invocation() }))
    .toMatchObject({ ok: true, result: { body: { dirty: false } } });
  const stream = (async function* () { yield Buffer.from(JSON.stringify(args)); })();
  expect(await world.http('/live_status', stream)).toMatchObject({ ok: true, result: { body: { dirty: false } } });
  const absent = createTransportWorld(['alice'], 'scope-a', { profile });
  expect(await absent.http('/live_status', args)).toMatchObject({ ok: false, failure: { publicCode: 'capability_unavailable', httpStatus: 503 } });
});
it('should preserve an unknown forge effect in the HTTP failure envelope', async () => {
  const profile = { ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: ['artifacts_git_commit'],
    operations: [{ operation: 'git_commit', limits: { idempotencyKeyMaxUnits: 256, gitMessageMaxUnits: 16384 }, defaults: {} }] };
  const world = createTransportWorld(['alice'], 'scope-a', { profile,
    live: { execute: async () => { throw new LiveCommitUnknownError(new Error('response lost')); } } });
  expect(await world.http('/git_commit', { artifactId: '11111111-1111-4111-8111-111111111111',
    expectedHeadSha: 'a'.repeat(40), files: [{ path: 'ui/a.ts', text: 'value' }], message: 'Commit', idempotencyKey: 'key' }))
    .toMatchObject({ ok: false, failure: { commitState: 'unknown', publicCode: 'git_live_conflict' } });
});
it('should project every closed live failure without leaking a driver cause', () => {
  for (const [kind, status] of Object.entries(LIVE_FAILURE_STATUS)) {
    const cause = new ArtifactOperationError(kind as keyof typeof LIVE_FAILURE_STATUS, {
      cause: new Error('private worker diagnostic'),
      ...(kind === 'git_live_conflict' ? { publicDetails: { reason: 'stale_fence' } } : {}) });
    const failure = classifyArtifactFailure(cause, { invocationId: 'inv', operation: 'live_write', phase: 'dispatch', commitState: 'not_committed' });
    expect(failure).toMatchObject({ httpStatus: status, publicCode: kind });
    expect(JSON.stringify(failure)).not.toContain('private worker diagnostic');
  }
});
