import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile } from '../src/profile/index.js';
import { encodeToolResult } from '../../mcp-platform/src/transport/result-codec.js';
import { projectArtifactMcpOutcome } from '../src/server/outcome-projection.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { ensureSite, parityWorld, PARITY_PROFILE_INPUT, publish, publishText, revert } from './fixtures/parity-world.js';

const strictProfile = { ...PARITY_PROFILE_INPUT, requireExpectedCurrentReleaseId: true };
const strictWorld = () => createTransportWorld(['alice', 'bob'], 'scope-l6', { profile: strictProfile });
const idOf = (response: { body: unknown }) => (response.body as { releaseId: string }).releaseId;

describe('D3 publication preconditions and replay', () => {
  it('should require an explicit precondition on HTTP and MCP in a strict profile', async () => {
    const w = strictWorld();
    const artifactId = await ensureSite(w, 'strict');
    const args = { artifactId, idempotencyKey: 'missing', files: [
      { path: 'index.html', mimeType: 'text/html', text: 'one' }] };
    const outcome = await w.http('/publish', args);
    expect(outcome).toMatchObject({ ok: false, failure: { publicCode: 'precondition_required', httpStatus: 428 } });
    expect((await publish(w, artifactId, 'missing', args)).status).toBe(428);
    const first = await publishText(w, artifactId, 'one', 'first', { expectedCurrentReleaseId: null });
    expect(first.status).toBe(201);
    expect((await publishText(w, artifactId, 'two', 'second', { expectedCurrentReleaseId: null })).status).toBe(409);
    expect((await revert(w, { artifactId, releaseId: idOf(first), idempotencyKey: 'revert' })).status).toBe(428);
    expect(w.profile.schemas.artifacts_publish?.required).toContain('expectedCurrentReleaseId');
  });

  it('should refuse bypass writers and precondition defaults in strict profiles', () => {
    expect(() => compileArtifactsProfile({ ...strictProfile, selectedCapabilities: [
      ...strictProfile.selectedCapabilities, 'artifacts_promote'] })).toThrow();
    expect(() => compileArtifactsProfile({ ...strictProfile, operations: strictProfile.operations.map(op =>
      op.operation === 'publish' ? { ...op, defaults: { ...op.defaults, expectedCurrentReleaseId: null } } : op) })).toThrow();
  });

  it('should replay edits before checking a stale head or reapplying oldStr', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'replay');
    const first = await publishText(w, artifactId, 'one', 'first');
    const args = { expectedCurrentReleaseId: idOf(first), title: 'New title',
      edits: [{ path: 'index.html', oldStr: 'one', newStr: 'two' }] };
    const second = await publish(w, artifactId, 'edit', args);
    expect(second.status).toBe(201);
    const quota = w.quotaReservations.length;
    const replay = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(),
      args: { artifactId, idempotencyKey: 'edit', ...args } });
    expect(replay).toMatchObject({ ok: true, replayed: true, commitState: 'committed', result: second });
    expect(w.quotaReservations).toHaveLength(quota);
    expect(await w.state.listReleases(artifactId)).toHaveLength(2);
    w.deny();
    expect((await publish(w, artifactId, 'edit', args)).status).toBe(403);
  });

  it('should distinguish a different command under the same key from a pointer conflict', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'identity');
    const args = { files: [{ path: 'index.html', mimeType: 'text/html', text: 'one' }], title: 'One' };
    expect((await publish(w, artifactId, 'key', args)).status).toBe(201);
    for (const change of [{ title: 'Two' }, { expectedCurrentReleaseId: randomUUID() },
      { files: undefined, edits: [{ path: 'index.html', oldStr: 'one', newStr: 'two' }] }]) {
      const input = { ...args, ...change };
      if (input.files === undefined) delete input.files;
      const outcome = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(),
        args: { artifactId, idempotencyKey: 'key', ...input } });
      expect(outcome).toMatchObject({ ok: false, failure: { variant: 'command_conflict', commitState: 'not_committed' } });
    }
    expect(await w.state.listReleases(artifactId)).toHaveLength(1);
  });

  it('should allow only one concurrent publisher on the same observed release', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'race');
    const first = await publishText(w, artifactId, 'one', 'first');
    const results = await Promise.all(['two', 'three'].map(text => publishText(w, artifactId, text, text,
      { expectedCurrentReleaseId: idOf(first), title: text })));
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await w.state.listReleases(artifactId)).toHaveLength(2);
    const winner = results.find(result => result.status === 201)!;
    expect((await w.acls.getArtifactAcl(artifactId))?.metadata?.title).toBe((winner.body as { title: string }).title);
  });

  it('should transmit complete domain failures through the shared MCP wire codec', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'wire');
    await publishText(w, artifactId, 'one one', 'first');
    const outcome = await w.mcp.execute({ tool: 'artifacts_publish', invocation: w.invocation(),
      args: { artifactId, idempotencyKey: 'ambiguous', edits: [{ path: 'index.html', oldStr: 'one', newStr: 'two' }] } });
    const wire = encodeToolResult(projectArtifactMcpOutcome(outcome, 'audit'));
    expect(wire.isError).toBe(true);
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toMatchObject({ ok: false,
      commitState: 'not_committed', error: { code: 'edit_mismatch', retriable: false,
        details: { path: 'index.html', editIndex: 0, reason: 'ambiguous' } } });
  });
});
