/**
 * Parity P0 — display metadata: title/description/icon (one short word) on
 * ensure and publish, returned by get and list; invalid values rejected.
 */
import { describe, expect, it } from 'vitest';
import { ensureSite, getMeta, listAll, parityWorld, publish, type Body } from './fixtures/parity-world.js';

describe('metadata title/description/icon', () => {
  it('should accept metadata on ensure and return it from get and list', async () => {
    const w = parityWorld();
    const res = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'meta', idempotencyKey: 'md-1', title: 'My page',
        description: 'A demo page', icon: 'chart' } });
    expect(res.status).toBe(201);
    expect((res.body as Body).title).toBe('My page');
    const artifactId = (res.body as Body).artifactId as string;
    const meta = await getMeta(w, artifactId);
    expect((meta.body as Body).metadata).toEqual({ title: 'My page', description: 'A demo page', icon: 'chart' });
    const list = await listAll(w);
    const entry = (list.body as Body).artifacts as Record<string, unknown>[];
    expect(entry[0].metadata).toEqual({ title: 'My page', description: 'A demo page', icon: 'chart' });
  });

  it('should update metadata on publish', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'md-pub', { title: 'v1 title', icon: 'doc' });
    const res = await publish(w, artifactId, 'md-p1', {
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'hi' }], title: 'v2 title' });
    expect(res.status).toBe(201);
    const meta = await getMeta(w, artifactId);
    const metadata = (meta.body as Body).metadata as Body;
    expect(metadata.title).toBe('v2 title');
    expect(metadata.icon).toBe('doc');
  });

  it('should reject a multi-word icon and oversized title as invalid_request', async () => {
    const w = parityWorld();
    const badIcon = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'bad', idempotencyKey: 'md-bad', icon: 'not a word' } });
    expect(badIcon.status).toBe(400);
    const badTitle = await w.mcp.invoke({ tool: 'artifacts_ensure', invocation: w.invocation(),
      args: { bindingName: 'bad2', idempotencyKey: 'md-bad2', title: 'x'.repeat(201) } });
    expect(badTitle.status).toBe(400);
  });
});
