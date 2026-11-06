import { expect, it } from 'vitest';
import { createTransportWorld } from './fixtures/transport-world.js';
import { RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { liveWitness } from './live-tools.test.js';
import { LIVE_FAILURE_STATUS } from '../src/server/live-errors.js';
import { ArtifactOperationError, classifyArtifactFailure } from '../src/server/failures.js';

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
  const absent = createTransportWorld(['alice'], 'scope-a', { profile });
  expect(await absent.http('/live_status', args)).toMatchObject({ ok: false, failure: { publicCode: 'capability_unavailable', httpStatus: 503 } });
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
