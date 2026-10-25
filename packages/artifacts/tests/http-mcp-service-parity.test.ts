import { describe, expect, it } from 'vitest';
import { createTransportWorld as atomicTransport } from './fixtures/transport-world.js';

describe('L6 authorized HTTP/MCP parity', () => {
  const args = { bindingName: 'site', idempotencyKey: ' caller key ' };
  it('should replay ensure across transports with current authorization', async () => {
    const host = atomicTransport();
    const first = await host.http('/ensure', args);
    expect(first).toMatchObject({ ok: true, commitState: 'committed' });
    const replay = await host.mcp.execute({ tool: 'artifacts_ensure', args, invocation: host.invocation() });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: { body: { replayed: true } } });
    expect(host.receipts.size).toBe(1);
    host.deny();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(host.receipts.size).toBe(1);
  });
  it('should leave no success after denial and allow a fresh same-key attempt', async () => {
    const host = atomicTransport();
    host.deny();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: false });
    expect(host.receipts.size).toBe(0);
    expect(host.bindings.size).toBe(0);
    host.allow();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: true, replayed: false });
  });
  it('should keep canonical verified subjects distinct', async () => {
    const host = atomicTransport();
    await host.http('/ensure', args, host.invocation('alice'));
    const other = await host.mcp.execute({ tool: 'artifacts_ensure', args, invocation: host.invocation('issuer|alice') });
    expect(other).toMatchObject({ ok: true, replayed: false });
    expect(host.receipts.size).toBe(2);
  });
  it('should bind the request guard through publication and replay', async () => {
    const host = atomicTransport();
    const ensured = await host.http('/ensure', args);
    if (!ensured.ok) throw new Error('ensure failed');
    const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
    const publish = { artifactId, idempotencyKey: 'publish', files: [{ path: 'index.html', mimeType: 'text/html', text: 'hi' }] };
    host.deny();
    expect(await host.http('/publish', publish)).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(host.releases.size).toBe(0);
    expect(host.receipts.size).toBe(1);
    host.allow();
    const first = await host.http('/publish', publish);
    expect(first).toMatchObject({ ok: true, replayed: false });
    const replay = await host.mcp.execute({ tool: 'artifacts_publish', args: publish, invocation: host.invocation() });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    if (!first.ok || !replay.ok) throw new Error('publish failed');
    expect(replay.result.body).toEqual(first.result.body);
    expect(first.result.body).toMatchObject({ artifactId,
      stableUrl: `https://artifacts.test/a/${artifactId}`, pinnedUrl: expect.stringContaining('/r/'),
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(replay.result.body).not.toHaveProperty('replayed');
    expect(host.guardCalls()).toBeGreaterThan(0);
    expect(host.releases.size).toBe(1);
  });
  it.each(['bytes', 'path', 'mime', 'profile', 'order'])(
    'should conflict on changed %s through the other transport', async (change) => {
      const host = atomicTransport();
      const ensured = await host.http('/ensure', args);
      if (!ensured.ok) throw new Error('ensure failed');
      const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
      const files = [
        { path: 'index.html', mimeType: 'text/html', text: 'hi' },
        { path: 'style.css', mimeType: 'text/css', text: 'body{}' },
      ];
      const publish = { artifactId, idempotencyKey: 'identity', files, profile: {} };
      expect(await host.http('/publish', publish)).toMatchObject({ ok: true });
      const changed = structuredClone(publish);
      if (change === 'bytes') changed.files[0].text = 'changed';
      if (change === 'path') changed.files[0].path = 'other.html';
      if (change === 'mime') changed.files[0].mimeType = 'application/json';
      if (change === 'profile') changed.profile = { variant: 'changed' };
      if (change === 'order') changed.files.reverse();
      expect(await host.mcp.execute({ tool: 'artifacts_publish', args: changed,
        invocation: host.invocation() })).toMatchObject({ ok: false, failure: {
        category: 'conflict', httpStatus: 409, retriable: false,
      } });
      expect(host.releases.size).toBe(1);
    },
  );
});
