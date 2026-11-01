/**
 * Parity P0 — artifacts_list_versions and artifacts_revert over the memory
 * transport world: release history (id, createdAt, author, state, isCurrent,
 * digest) and revert-as-new-release (stable URL, history grows, purged
 * refused with typed gone, idempotent per principal).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createArtifactsManifest } from '../src/mcp-core.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { ensureSite, getSource, listVersions, parityProfile, parityWorld, publishText, revert,
  type Body } from './fixtures/parity-world.js';

describe('artifacts_list_versions', () => {
  it('should list the release history with id, createdAt, author, state, isCurrent and digest', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'lv-ensure');
    const v1 = await publishText(w, artifactId, '<h1>v1</h1>', 'lv-p1');
    const v2 = await publishText(w, artifactId, '<h1>v2</h1>', 'lv-p2');
    expect(v1.status).toBe(201);
    expect(v2.status).toBe(201);
    const res = await listVersions(w, artifactId);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body.artifactId).toBe(artifactId);
    expect(body.total).toBe(2);
    const releases = body.releases as Record<string, unknown>[];
    expect(releases).toHaveLength(2);
    expect(releases[0].releaseId).toBe((v1.body as Body).releaseId);
    expect(releases[1].releaseId).toBe((v2.body as Body).releaseId);
    expect(releases[0].isCurrent).toBe(false);
    expect(releases[1].isCurrent).toBe(true);
    for (const release of releases) {
      expect(release.author).toBe('alice');
      expect(release.state).toBe('ready');
      expect(typeof release.createdAt).toBe('string');
      expect(release.digest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(releases[0].digest).toBe((v1.body as Body).digest);
    expect(releases[1].digest).toBe((v2.body as Body).digest);
  });

  it('should report retired state for a supplanted release', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'lv-retired');
    const v1 = await publishText(w, artifactId, 'one', 'lr-p1');
    await publishText(w, artifactId, 'two', 'lr-p2');
    await w.lifecycleStore.setReleaseState((v1.body as Body).releaseId as string, 'retired');
    const res = await listVersions(w, artifactId);
    const releases = (res.body as Body).releases as Record<string, unknown>[];
    expect(releases[0].state).toBe('retired');
    expect(releases[1].state).toBe('ready');
  });

  it('should hide unknown or foreign-scope artifacts as not_found', async () => {
    const w = parityWorld();
    const res = await listVersions(w, randomUUID());
    expect(res.status).toBe(404);
    expect((res.body as Body).error).toBe('not_found');
  });

  it('should stay unselected on the default Radar profile and read-only when selected', async () => {
    const radar = createTransportWorld();
    const res = await radar.mcp.invoke({ tool: 'artifacts_list_versions',
      invocation: radar.invocation(), args: { artifactId: randomUUID() } });
    expect(res.status).toBe(503);
    expect((res.body as Body).error).toBe('capability_unavailable');
    const manifest = createArtifactsManifest({ profile: parityProfile() });
    expect(manifest.tools.find((t) => t.name === 'artifacts_list_versions')?.mutability).toBe('read-only');
    expect(manifest.tools.find((t) => t.name === 'artifacts_revert')?.idempotency)
      .toEqual({ required: true, scope: 'principal' });
  });
});

describe('artifacts_revert', () => {
  it('should create a NEW release copying the earlier content, keeping the stable URL and growing history', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'rv-ensure');
    const v1 = await publishText(w, artifactId, '<h1>v1</h1>', 'rv-p1');
    const v2 = await publishText(w, artifactId, '<h1>v2</h1>', 'rv-p2');
    const res = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId, idempotencyKey: 'rv-1' });
    expect(res.status).toBe(201);
    const body = res.body as Body;
    expect(body.artifactId).toBe(artifactId);
    expect(body.releaseId).not.toBe((v1.body as Body).releaseId);
    expect(body.digest).toBe((v1.body as Body).digest);
    expect(body.stableUrl).toBe((v1.body as Body).stableUrl);
    const versions = await listVersions(w, artifactId);
    const releases = (versions.body as Body).releases as Record<string, unknown>[];
    expect(releases).toHaveLength(3);
    expect(releases[2].releaseId).toBe(body.releaseId);
    expect(releases[2].isCurrent).toBe(true);
    expect(releases[2].digest).toBe((v1.body as Body).digest);
    const source = await getSource(w, artifactId);
    expect(((source.body as Body).files as Record<string, unknown>[])[0].text).toBe('<h1>v1</h1>');
  });

  it('should replay the same idempotency key instead of creating another release', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'rv-idem');
    const v1 = await publishText(w, artifactId, 'a', 'ri-p1');
    await publishText(w, artifactId, 'b', 'ri-p2');
    const first = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId, idempotencyKey: 'ri-r' });
    const second = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId, idempotencyKey: 'ri-r' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as Body).releaseId).toBe((first.body as Body).releaseId);
    const versions = await listVersions(w, artifactId);
    expect((versions.body as Body).releases).toHaveLength(3);
  });

  it('should refuse a purged release with a typed gone error', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'rv-purged');
    const v1 = await publishText(w, artifactId, 'a', 'rp-p1');
    await publishText(w, artifactId, 'b', 'rp-p2');
    await w.lifecycleStore.setReleaseState((v1.body as Body).releaseId as string, 'purged');
    const res = await revert(w, { artifactId, releaseId: (v1.body as Body).releaseId, idempotencyKey: 'rp-r' });
    expect(res.status).toBe(410);
    expect((res.body as Body).error).toBe('gone');
    const versions = await listVersions(w, artifactId);
    expect((versions.body as Body).releases).toHaveLength(2);
  });

  it('should refuse an unknown release and a foreign release id with not_found', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'rv-404');
    await publishText(w, artifactId, 'a', 'r4-p1');
    expect((await revert(w, { artifactId, releaseId: randomUUID(), idempotencyKey: 'r4-a' })).status).toBe(404);
    const other = await ensureSite(w, 'rv-404-b');
    const otherRelease = await publishText(w, other, 'x', 'r4-p2');
    const res = await revert(w, { artifactId, releaseId: (otherRelease.body as Body).releaseId, idempotencyKey: 'r4-b' });
    expect(res.status).toBe(404);
  });

  it('should refuse a non-owner as not_found', async () => {
    const w = parityWorld();
    const artifactId = await ensureSite(w, 'rv-owner');
    const v1 = await publishText(w, artifactId, 'a', 'ro-p1');
    const res = await w.mcp.invoke({ tool: 'artifacts_revert', invocation: w.invocation('bob'),
      args: { artifactId, releaseId: (v1.body as Body).releaseId, idempotencyKey: 'ro-r' } });
    expect(res.status).toBe(404);
  });
});
