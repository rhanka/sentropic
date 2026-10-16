/** L-5e — reusable pages provider + dispatch (spec-v8 §9 5e). One provider, exact public names, app delegation. */
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp } from '../src/http.js';
import { createArtifactService } from '../src/server/service.js';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import {
  createLifecycleService,
  createMemoryLifecycleStore,
} from '../src/server/lifecycle.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemorySourceStore } from '../src/server/sources.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';
import { assertNoPublicNameCollisions, publicNameMap } from '../src/provider-definition.js';
import { definePagesProvider, createPagesDispatch, PAGES_PROVIDER_ID } from '../src/server/pages.js';

const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);
const FILES = [{ path: 'index.html', mimeType: 'text/html', bytes: [1, 2, 3] }];

function makeDispatch(defaultStorageScopeId = 'scope-1') {
  const kv = createMemoryKv();
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const app = createHttpArtifactApp({
    parameterSchema: SCHEMA,
    artifacts: createArtifactService({ kv, uuid: createCryptoUuid() }),
    publication: createPublicationService({
      state,
      blobs,
      intents: createMemoryIntentStore(),
      idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
    }),
    lifecycle: createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00.000Z', state),
    forks: createForkService(createMemoryForkStore()),
    acls: createMemoryAclStore(),
    sources: createMemorySourceStore(),
    blobs,
  });
  return createPagesDispatch({ app, defaultStorageScopeId });
}

describe('pages provider', () => {
  it('exposes four exact public names without collisions', () => {
    const def = definePagesProvider();
    expect(def.providerId).toBe(PAGES_PROVIDER_ID);
    const map = publicNameMap(def);
    expect(map.get('pages_ensure_site')).toEqual({ providerId: 'pages', capabilityName: 'ensure-site' });
    expect(map.get('pages_publish_site')).toEqual({ providerId: 'pages', capabilityName: 'publish-site' });
    expect(map.get('pages_read_page')).toEqual({ providerId: 'pages', capabilityName: 'read-page' });
    expect(map.get('pages_serve_content')).toEqual({ providerId: 'pages', capabilityName: 'serve-content' });
    expect(() => assertNoPublicNameCollisions([def, definePagesProvider()])).not.toThrow();
  });

  it('runs ensure, publish, read and serve through one dispatch', async () => {
    const dispatch = makeDispatch();
    const ensured = await dispatch.invoke({
      capability: 'ensure-site',
      actorId: 'owner-1',
      args: { bindingName: 'site', idempotencyKey: 'k-1', paramsHash: 'h-1', parameters: { title: 'Hi' } },
    });
    expect(ensured.status).toBe(201);
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const published = await dispatch.invoke({
      capability: 'publish-site',
      actorId: 'owner-1',
      args: { artifactId, profile: {}, files: FILES, idempotencyKey: 'p-1', paramsHash: 'h-1' },
    });
    expect(published.status).toBe(201);
    const read = await dispatch.invoke({ capability: 'read-page', actorId: 'owner-1', args: { artifactId } });
    expect(read.status).toBe(200);
    const manifest = JSON.parse((read.body as { manifest: string }).manifest) as {
      files: { digest: string }[];
    };
    const digest = manifest.files[0]?.digest ?? '';
    const served = await dispatch.invoke({
      capability: 'serve-content',
      actorId: 'owner-1',
      args: { artifactId, digest },
    });
    expect(served.status).toBe(200);
    expect(served.body).toMatchObject({ digest, bytes: [1, 2, 3] });
  });

  it('denies strangers and rejects unknown capabilities without oracling', async () => {
    const dispatch = makeDispatch();
    const ensured = await dispatch.invoke({
      capability: 'ensure-site',
      actorId: 'owner-1',
      args: { bindingName: 'site', idempotencyKey: 'k-9', paramsHash: 'h-9', parameters: { title: 'Hi' } },
    });
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const stranger = await dispatch.invoke({
      capability: 'read-page',
      actorId: 'stranger-1',
      args: { artifactId },
    });
    expect(stranger.status).toBe(404);
    await expect(
      dispatch.invoke({ capability: 'nope', actorId: 'owner-1', args: {} }),
    ).rejects.toThrow(/unknown pages capability/);
  });
});
