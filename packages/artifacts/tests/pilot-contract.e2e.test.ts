/** Radar pilot journey over the four selected tools and fresh request contexts. */
import { describe, expect, it } from 'vitest';
import { createArtifactsToolExecutor } from '../src/mcp.js';
import { createTransportWorld } from './fixtures/transport-world.js';

describe('selected pilot contract', () => {
  it('should ensure, publish, rediscover and replay through fresh guarded sessions', async () => {
    const world = createTransportWorld(['farid', 'steve'], 'scope-pilot');
    const session = () => createArtifactsToolExecutor({ app: world.app, profile: world.profile });
    const call = async (tool: string, args: unknown, actor = 'farid') =>
      session().invoke({ tool, args, invocation: world.invocation(actor) });
    const ensured = await call('artifacts_ensure', { bindingName: 'pilot-view', idempotencyKey: 'ensure' });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const publish = { artifactId, idempotencyKey: 'publish',
      files: [{ path: 'index.html', mimeType: 'text/html', text: '<h1>Pilot view</h1>' }] };
    const first = await call('artifacts_publish', publish);
    expect(first.status).toBe(201);
    const listed = await call('artifacts_list', {});
    expect(listed).toMatchObject({ status: 200, body: { total: 1, artifacts: [{ artifactId }] } });
    const meta = await call('artifacts_get', { artifactId });
    expect(meta).toMatchObject({ status: 200, body: {
      artifactId, currentReleaseId: (first.body as { releaseId: string }).releaseId,
    } });
    expect(await call('artifacts_get', { artifactId }, 'steve')).toMatchObject({ status: 404 });
    world.deny();
    expect(await call('artifacts_publish', publish)).toMatchObject({ status: 403 });
    expect(world.receipts.size).toBe(2);
    world.allow();
    expect(await call('artifacts_publish', publish)).toEqual(first);
    expect(world.receipts.size).toBe(2);
    expect(world.releases.size).toBe(1);
  });

  it.each(['artifacts_get_api_guide', 'artifacts_get_template', 'artifacts_fork',
    'artifacts_set_access', 'artifacts_delete', 'artifacts_restore'])(
    'should refuse unselected pilot tool %s before a write', async (tool) => {
      const world = createTransportWorld(['farid'], 'scope-pilot');
      expect(await world.mcp.invoke({ tool, args: {}, invocation: world.invocation() }))
        .toEqual({ status: 503, body: { error: 'capability_unavailable' } });
      expect(world.receipts.size).toBe(0);
      expect(world.bindings.size).toBe(0);
    },
  );
});
