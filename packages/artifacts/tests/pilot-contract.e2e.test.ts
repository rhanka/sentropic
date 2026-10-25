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

    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'read',
    }, 200);
    await call(s2, 'artifacts_get', STEVE, { artifactId: id }, 200);
    await call(s2, 'artifacts_get', THIRD, { artifactId: id }, 404);
    await call(s2, 'artifacts_get_source', STEVE, { artifactId: id }, 403);
    // Steve forks privately; the fork survives the parent lifecycle.
    const forked = await call(s2, 'artifacts_fork', STEVE, { artifactId: id }, 201);
    const forkId = forked['artifactId'] as string;
    expect(forkId).not.toBe(id);
    // Publish v2, roll back to v1 explicitly.
    const v2 = await call(s2, 'artifacts_publish', FARID, {
      artifactId: id,
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: toBytes('<h1>v2</h1>') }],
      idempotencyKey: 'p-2', paramsHash: 'h-2',
    }, 201);
    await call(s2, 'artifacts_promote', FARID, {
      artifactId: id, releaseId: v1['releaseId'], expectedCurrent: v2['releaseId'],
    }, 200);
    const meta = await call(s2, 'artifacts_get', FARID, { artifactId: id }, 200);
    expect(meta['currentReleaseId']).toBe(v1['releaseId']);
    // Grant source, export, then withdraw and undo before purge.
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'source',
    }, 400); // duplicate principal grant refused; revoke then re-grant
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'revoke', principalId: STEVE,
    }, 200);
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'source',
    }, 200);
    const source = await call(s2, 'artifacts_get_source', STEVE, { artifactId: id }, 200);
    expect(source).toEqual({ kind: 'inline-original' });
    await call(s2, 'artifacts_delete', FARID, { artifactId: id }, 200);
    const restored = await call(s2, 'artifacts_restore', FARID, { artifactId: id }, 200);
    expect(restored['state']).toBe('active');
    const after = await call(s2, 'artifacts_get', STEVE, { artifactId: id }, 200);
    expect(after['state']).toBe('active');
  });
});
