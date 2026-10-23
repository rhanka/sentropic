/**
 * L-5e (B3) — HTTP routes backing the remaining artifacts_* tools: list
 * (ACL before pagination), metadata, and the public-access toggle. The app
 * stays transport-free and delegates to the same services as direct calls.
 */
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp, type HttpRequest } from '../src/http.js';
import { createArtifactService } from '../src/server/service.js';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../src/server/lifecycle.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemorySourceStore } from '../src/server/sources.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';

const OWNER = 'owner-1';
const OTHER = 'owner-2';
const READER = 'reader-1';
const APPROVED = 'approved-1';
const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);
const FILES = [{ path: 'index.html', mimeType: 'text/html', bytes: [1] }];

function makeApp() {
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  return createHttpArtifactApp({
    parameterSchema: SCHEMA,
    artifacts: createArtifactService({ kv: createMemoryKv(), uuid: createCryptoUuid() }),
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
    isApprovedAccount: (principalId) => principalId === APPROVED,
  });
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId, storageScopeId: "scope-1" };
}

type App = ReturnType<typeof makeApp>;

async function ensure(app: App, actor: string, binding: string): Promise<string> {
  const res = await app.handle(
    req('POST', '/ensure', {
      bindingName: binding, storageScopeId: 'scope-1', idempotencyKey: `k-${actor}-${binding}`,
      paramsHash: 'h-1', parameters: { title: binding },
    }, actor),
  );
  expect(res.status).toBe(201);
  const id = (res.body as { artifactId: string }).artifactId;
  await app.handle(
    req('POST', '/publish', {
      artifactId: id, profile: {}, files: FILES, idempotencyKey: `p-${actor}-${binding}`, paramsHash: 'h-1',
    }, actor),
  );
  return id;
}

describe('http list/meta/public routes', () => {
  it('lists only visible artifacts, filtered before pagination', async () => {
    const app = makeApp();
    const mine1 = await ensure(app, OWNER, 'one');
    const mine2 = await ensure(app, OWNER, 'two');
    const theirs = await ensure(app, OTHER, 'three');
    await app.handle(
      req('POST', '/access/grant', { artifactId: mine2, principalId: READER, grant: 'read' }, OWNER),
    );
    const own = await app.handle(req('POST', '/list', {}, OWNER));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ total: 2 });
    const ownIds = (own.body as { artifacts: { artifactId: string }[] }).artifacts.map((a) => a.artifactId);
    expect(ownIds).toEqual([mine1, mine2]);
    const reader = await app.handle(req('POST', '/list', {}, READER));
    expect(reader.body).toMatchObject({ total: 1, artifacts: [{ artifactId: mine2 }] });
    const other = await app.handle(req('POST', '/list', {}, OTHER));
    expect(other.body).toMatchObject({ total: 1, artifacts: [{ artifactId: theirs }] });
    const page = await app.handle(req('POST', '/list', { limit: 1, offset: 1 }, OWNER));
    expect(page.body).toMatchObject({ total: 2, artifacts: [{ artifactId: mine2 }] });
    const badLimit = await app.handle(req('POST', '/list', { limit: 0 }, OWNER));
    expect(badLimit.status).toBe(400);
    const badOffset = await app.handle(req('POST', '/list', { offset: -1 }, OWNER));
    expect(badOffset.status).toBe(400);
  });

  it('returns metadata with grants visible to the owner only', async () => {
    const app = makeApp();
    const id = await ensure(app, OWNER, 'meta');
    await app.handle(
      req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER),
    );
    const ownerMeta = await app.handle(req('GET', `/meta/${id}`, undefined, OWNER));
    expect(ownerMeta.status).toBe(200);
    expect(ownerMeta.body).toMatchObject({
      artifactId: id, ownerId: OWNER, state: 'active', isPublic: false,
      grants: [{ principalId: READER, grant: 'read' }],
    });
    expect(typeof (ownerMeta.body as { currentReleaseId: unknown }).currentReleaseId).toBe('string');
    const readerMeta = await app.handle(req('GET', `/meta/${id}`, undefined, READER));
    expect(readerMeta.status).toBe(200);
    expect(readerMeta.body).toMatchObject({ artifactId: id, ownerId: OWNER });
    expect((readerMeta.body as { grants?: unknown }).grants).toBeUndefined();
    const strangerMeta = await app.handle(req('GET', `/meta/${id}`, undefined, OTHER));
    expect(strangerMeta.status).toBe(404);
  });

  it('toggles public access owner-only; approved accounts then read', async () => {
    const app = makeApp();
    const id = await ensure(app, OWNER, 'pub');
    const before = await app.handle(req('GET', `/current/${id}`, undefined, APPROVED));
    expect(before.status).toBe(404);
    const byStranger = await app.handle(
      req('POST', '/access/public', { artifactId: id, isPublic: true }, OTHER),
    );
    expect(byStranger.status).toBe(404);
    const toggled = await app.handle(
      req('POST', '/access/public', { artifactId: id, isPublic: true }, OWNER),
    );
    expect(toggled.status).toBe(200);
    expect(toggled.body).toEqual({ artifactId: id, isPublic: true });
    const after = await app.handle(req('GET', `/current/${id}`, undefined, APPROVED));
    expect(after.status).toBe(200);
    const unapproved = await app.handle(req('GET', `/current/${id}`, undefined, OTHER));
    expect(unapproved.status).toBe(404);
    const invalid = await app.handle(
      req('POST', '/access/public', { artifactId: id, isPublic: 'yes' }, OWNER),
    );
    expect(invalid.status).toBe(400);
  });
});
