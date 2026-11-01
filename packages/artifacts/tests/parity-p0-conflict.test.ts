/**
 * Parity P0 — optimistic concurrency: expectedCurrentReleaseId on publish and
 * revert returns a typed conflict (409) carrying the current release id and
 * digest; without the field, behaviour is unchanged.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureSite, listVersions, parityWorld, publish, publishText, revert,
  type Body } from './fixtures/parity-world.js';

describe('conflict detection via expectedCurrentReleaseId', () => {
  it('should return a typed conflict carrying the current release id and digest on publish', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'cf-pub');
    const v1 = await publishText(w, artifactId, 'one', 'cf-p1');
    const stale = await publish(w, artifactId, 'cf-stale', {
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'stale' }],
      expectedCurrentReleaseId: randomUUID() });
    expect(stale.status).toBe(409);
    const staleBody = stale.body as Body;
    expect(staleBody.error).toBe('conflict');
    expect((staleBody.conflict as Body).currentReleaseId).toBe((v1.body as Body).releaseId);
    expect((staleBody.conflict as Body).currentDigest).toBe((v1.body as Body).digest);
    const ok = await publish(w, artifactId, 'cf-ok', {
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'ok' }],
      expectedCurrentReleaseId: (v1.body as Body).releaseId });
    expect(ok.status).toBe(201);
    const noField = await publishText(w, artifactId, 'no field', 'cf-p3');
    expect(noField.status).toBe(201);
  });

  it('should return the same typed conflict on revert when the pointer moved', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'cf-rv');
    const v1 = await publishText(w, artifactId, 'one', 'cr-p1');
    const v2 = await publishText(w, artifactId, 'two', 'cr-p2');
    const res = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId,
      idempotencyKey: 'cr-r', expectedCurrentReleaseId: (v1.body as Body).releaseId });
    expect(res.status).toBe(409);
    const body = res.body as Body;
    expect(body.error).toBe('conflict');
    expect((body.conflict as Body).currentReleaseId).toBe((v2.body as Body).releaseId);
    expect((body.conflict as Body).currentDigest).toBe((v2.body as Body).digest);
    const ok = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId,
      idempotencyKey: 'cr-r2', expectedCurrentReleaseId: (v2.body as Body).releaseId });
    expect(ok.status).toBe(201);
  });

  it('should carry the conflict details on the MCP adapter outcome', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'cf-mcp');
    const v1 = await publishText(w, artifactId, 'one', 'cm-p1');
    const outcome = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(),
      args: { artifactId, idempotencyKey: 'cm-stale',
        files: [{ path: 'index.html', mimeType: 'text/html', text: 'x' }],
        expectedCurrentReleaseId: randomUUID() } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.publicCode).toBe('conflict');
      expect(outcome.failure.httpStatus).toBe(409);
      expect((outcome.failure as unknown as Body).conflict).toEqual({
        currentReleaseId: (v1.body as Body).releaseId, currentDigest: (v1.body as Body).digest });
    }
    // History untouched by the refused call.
    const versions = await listVersions(w, artifactId);
    expect((versions.body as Body).releases).toHaveLength(1);
  });
});
