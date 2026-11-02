import { describe, expect, it } from 'vitest';
import { encodeToolResult } from '../../mcp-platform/src/transport/result-codec.js';
import { projectArtifactMcpOutcome } from '../src/server/outcome-projection.js';
import { ensureSite, parityWorld, publish, publishText, revert } from './fixtures/parity-world.js';
const releaseId = (response: { body: unknown }) => (response.body as { releaseId: string }).releaseId;

describe('D3 recovery and conflict content', () => {
  it('should report unknown after a lost COMMIT acknowledgement and replay the same key once', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'unknown');
    const begin = w.executor.beginFinalization.bind(w.executor);
    let lose = true;
    w.executor.beginFinalization = async () => {
      const connection = await begin();
      const commit = connection.commit.bind(connection);
      connection.commit = async () => {
        await commit();
        if (lose) { lose = false; throw Object.assign(new Error('acknowledgement lost'), { code: 'ECONNRESET' }); }
      };
      return connection;
    };
    const args = { artifactId, idempotencyKey: 'lost', expectedCurrentReleaseId: null,
      files: [{ path: 'index.html', mimeType: 'text/html', text: 'one' }] };
    const first = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(), args });
    expect(first).toMatchObject({ ok: false, failure: { commitState: 'unknown' } });
    const wire = encodeToolResult(projectArtifactMcpOutcome(first, 'audit'));
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toMatchObject({ ok: false, commitState: 'unknown' });
    const quota = w.quotaReservations.length;
    const replay = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(), args });
    expect(replay).toMatchObject({ ok: true, replayed: true, commitState: 'committed' });
    expect(await w.state.listReleases(artifactId)).toHaveLength(1);
    expect(w.quotaReservations).toHaveLength(quota);
  });

  it('should return only edited current paths for a stale edit without changing metadata', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'source');
    const first = await publishText(w, artifactId, 'one', 'first');
    const second = await publish(w, artifactId, 'second', { title: 'Current', files: [
      { path: 'index.html', mimeType: 'text/html', text: 'two' },
      { path: 'secret.json', mimeType: 'application/json', text: '{}' }] });
    const result = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(), args: {
      artifactId, idempotencyKey: 'stale', expectedCurrentReleaseId: releaseId(first), title: 'Stale',
      edits: [{ path: 'index.html', oldStr: 'one', newStr: 'three' }] } });
    const wire = encodeToolResult(projectArtifactMcpOutcome(result, 'audit'));
    const body = JSON.parse((wire.content[0] as { text: string }).text);
    expect(body).toMatchObject({ ok: false, commitState: 'not_committed', error: { code: 'conflict', details: {
      variant: 'pointer_conflict', artifactId, expectedCurrentReleaseId: releaseId(first), currentReleaseId: releaseId(second),
      currentSource: { releaseId: releaseId(second), files: [{ path: 'index.html', text: 'two' }] } } } });
    expect(body.error.details.currentSource.files).toHaveLength(1);
    expect((await w.acls.getArtifactAcl(artifactId))?.metadata?.title).toBe('Current');
  });

  it('should replay a revert before reading a subsequently unavailable target', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'revert');
    const first = await publishText(w, artifactId, 'one', 'first');
    const second = await publishText(w, artifactId, 'two', 'second');
    const args = { artifactId, releaseId: releaseId(first), expectedCurrentReleaseId: releaseId(second), idempotencyKey: 'revert' };
    const reverted = await revert(w, args);
    expect(reverted.status).toBe(201);
    const keys = await w.blobs.listKeys('artifacts/');
    for (const key of keys) await w.blobs.deleteBlob(key);
    expect(await revert(w, args)).toEqual(reverted);
    const unavailable = await w.mcp.execute({ tool: 'artifacts_revert', invocation: w.invocation(), args: {
      ...args, idempotencyKey: 'another', expectedCurrentReleaseId: releaseId(reverted) } });
    expect(projectArtifactMcpOutcome(unavailable, 'audit')).toMatchObject({ ok: false, commitState: 'not_committed',
      error: { code: 'release_unavailable', details: { reason: 'not_retained' } } });
  });
});
