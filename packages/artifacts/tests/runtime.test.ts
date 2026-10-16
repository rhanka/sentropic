/** L-5d — generic content runtime (spec-v8 §9 5d). Serve current release bytes to authorized readers only. */
import { describe, expect, it } from 'vitest';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemoryLifecycleStore, createLifecycleService } from '../src/server/lifecycle.js';
import {
  createMemoryBlobStore,
  createMemoryStateStore,
  createPublicationService,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createContentRuntime } from '../src/server/runtime.js';

const HTML = new TextEncoder().encode('<!doctype html><html><body>Hello</body></html>');

async function setup() {
  const acls = createMemoryAclStore();
  const lifecycle = createLifecycleService(createMemoryLifecycleStore());
  const blobs = createMemoryBlobStore();
  const publication = createPublicationService({
    state: createMemoryStateStore(),
    blobs,
    intents: createMemoryIntentStore(),
  });
  await lifecycle.register('a-1', 'owner-1');
  await acls.putArtifactAcl('a-1', {
    ownerId: 'owner-1',
    storageScopeId: 'scope-1',
    isPublic: false,
    withdrawn: false,
    grants: [],
  });
  const published = await publication.publish({
    ownerId: 'owner-1',
    storageScopeId: 'scope-1',
    artifactId: 'a-1',
    profile: {},
    files: [{ path: 'index.html', mimeType: 'text/html', bytes: HTML }],
  });
  await lifecycle.trackRelease('a-1', published.releaseId);
  const manifest = JSON.parse(published.manifest) as { files: { digest: string }[] };
  const digest = manifest.files[0]?.digest ?? '';
  const runtime = createContentRuntime({ acls, lifecycle, publication, blobs });
  return { acls, lifecycle, blobs, runtime, digest };
}

describe('content runtime', () => {
  it('serves current release bytes to the owner', async () => {
    const { runtime, digest } = await setup();
    const served = await runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'owner-1' });
    expect(served.mimeType).toBe('text/html');
    expect(served.size).toBe(HTML.length);
    expect(Buffer.from(served.bytes).toString()).toContain('Hello');
  });

  it('serves a granted reader and refuses strangers', async () => {
    const { acls, runtime, digest } = await setup();
    const acl = await acls.getArtifactAcl('a-1');
    if (acl === undefined) throw new Error('test setup lost the acl');
    await acls.putArtifactAcl('a-1', {
      ...acl,
      grants: [{ principalId: 'reader-1', grant: 'read' }],
    });
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'reader-1' }),
    ).resolves.toMatchObject({ mimeType: 'text/html' });
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'stranger' }),
    ).rejects.toThrow(/access denied/);
  });

  it('opens public reads to approved accounts only', async () => {
    const { acls, runtime, digest } = await setup();
    const acl = await acls.getArtifactAcl('a-1');
    if (acl === undefined) throw new Error('test setup lost the acl');
    await acls.putArtifactAcl('a-1', { ...acl, isPublic: true });
    const approved = (principalId: string): boolean => principalId === 'approved-1';
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'approved-1', isApproved: approved }),
    ).resolves.toMatchObject({ mimeType: 'text/html' });
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'anon-1', isApproved: approved }),
    ).rejects.toThrow(/access denied/);
  });

  it('suspends readers on withdrawal while the owner keeps access', async () => {
    const { acls, lifecycle, runtime, digest } = await setup();
    const acl = await acls.getArtifactAcl('a-1');
    if (acl === undefined) throw new Error('test setup lost the acl');
    await acls.putArtifactAcl('a-1', {
      ...acl,
      grants: [{ principalId: 'reader-1', grant: 'read' }],
    });
    await lifecycle.withdraw('a-1', 'owner-1');
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'reader-1' }),
    ).rejects.toThrow(/access denied/);
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'owner-1' }),
    ).resolves.toMatchObject({ mimeType: 'text/html' });
  });

  it('reports terminal states instead of serving', async () => {
    const { lifecycle, runtime, digest } = await setup();
    await lifecycle.deleteArtifact('a-1', 'owner-1');
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'owner-1' }),
    ).rejects.toThrow(/terminal/);
  });

  it('never oracles digests outside the current manifest', async () => {
    const { runtime } = await setup();
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest: `sha256:${'0'.repeat(64)}`, actorId: 'owner-1' }),
    ).rejects.toThrow(/unknown blob/);
  });

  it('fails closed on missing or truncated blobs', async () => {
    const { blobs, runtime, digest } = await setup();
    await blobs.deleteBlob(`artifacts/scope-1/blobs/sha256/${digest.slice('sha256:'.length)}`);
    await expect(
      runtime.serveFile({ artifactId: 'a-1', digest, actorId: 'owner-1' }),
    ).rejects.toThrow(/unknown blob/);
    const { blobs: blobs2, runtime: runtime2, digest: digest2 } = await setup();
    await blobs2.putBlob(
      `artifacts/scope-1/blobs/sha256/${digest2.slice('sha256:'.length)}`,
      HTML.slice(0, 3),
    );
    await expect(
      runtime2.serveFile({ artifactId: 'a-1', digest: digest2, actorId: 'owner-1' }),
    ).rejects.toThrow(/size mismatch/);
  });
});
