/**
 * L-5d — content serving journey (spec-v8 §9 5d): publish on the control
 * app, activate a version through a single-use ticket, serve raw bytes on
 * stable and pinned origins under short grants, fresh-version consent on
 * republish, and immediate cutoff on withdrawal (grant rechecked per
 * request). Actual domain/TLS/browser proof stays Radar-side.
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
import { createHmacGrantSigner, createMemoryTicketStore, createTicketService } from '../src/content/grants.js';
import { createContentHandler, type ContentRequest } from '../src/content/handler.js';

const FARID = 'farid';
const STEVE = 'steve';
const BASE = 'pages.example.test';
const V1 = '<!doctype html><h1>v1</h1>';
const V2 = '<!doctype html><h1>v2</h1>';
const bytes = (text: string): number[] => [...new TextEncoder().encode(text)];
const text = (data: Uint8Array | undefined): string => new TextDecoder().decode(data);

function makeWorld() {
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const acls = createMemoryAclStore();
  const lifecycle = createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00.000Z', state);
  const publication = createPublicationService({
    state,
    blobs,
    intents: createMemoryIntentStore(),
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
  });
  const app = createHttpArtifactApp({
    parameterSchema: defineParameters([{ key: 'title', type: 'string', required: true }]),
    artifacts: createArtifactService({ kv: createMemoryKv(), uuid: createCryptoUuid() }),
    publication,
    lifecycle,
    forks: createForkService(createMemoryForkStore()),
    acls,
    sources: createMemorySourceStore(),
    blobs,
  });
  const tickets = createTicketService({ store: createMemoryTicketStore() });
  const handler = createContentHandler({
    acls,
    lifecycle,
    publication,
    blobs,
    grants: createHmacGrantSigner({ secret: 'e2e-grant-secret' }),
    tickets,
    baseDomain: BASE,
  });
  return { app, handler, tickets };
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId };
}

type World = ReturnType<typeof makeWorld>;

async function publish(world: World, html: string, key: string): Promise<{ id: string; releaseId: string }> {
  const ensured = await world.app.handle(
    req('POST', '/ensure', {
      bindingName: 'view', storageScopeId: 'scope-1', idempotencyKey: 'e-1',
      paramsHash: 'h-1', parameters: { title: 'View' },
    }, FARID),
  );
  const id = (ensured.body as { artifactId: string }).artifactId;
  const published = await world.app.handle(
    req('POST', '/publish', {
      artifactId: id, profile: {},
      files: [
        { path: 'index.html', mimeType: 'text/html', bytes: bytes(html) },
        { path: 'service-worker.js', mimeType: 'text/javascript', bytes: bytes('self.x=1') },
      ],
      idempotencyKey: key, paramsHash: key,
    }, FARID),
  );
  expect(published.status).toBe(201);
  return { id, releaseId: (published.body as { releaseId: string }).releaseId };
}

async function activate(
  world: World, host: string, actorId: string, artifactId: string,
  releaseId: string, channel: 'stable' | 'pinned',
) {
  const issued = await world.tickets.issue({ subjectId: actorId, artifactId, releaseId, channel });
  const res = await world.handler.handle({ method: 'GET', host, path: '/', actorId, ticket: issued.ticketId });
  expect(res.status).toBe(200);
  const cookie = res.headers['set-cookie'];
  expect(cookie).toContain('__Host-artifacts_grant=');
  return cookie as string;
}

const get = (world: World, input: ContentRequest) => world.handler.handle(input);

describe('content serving e2e', () => {
  it('should refuse an r1 activation ticket when the stable origin now serves r2', async () => {
    const world = makeWorld();
    const v1 = await publish(world, V1, 'p-1');
    const issued = await world.tickets.issue({
      subjectId: FARID, artifactId: v1.id, releaseId: v1.releaseId, channel: 'stable',
    });
    await publish(world, V2, 'p-2');
    const response = await get(world, {
      method: 'GET', host: `${v1.id}.${BASE}`, path: '/', actorId: FARID, ticket: issued.ticketId,
    });
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('activates, serves raw bytes, pins releases and cuts off on withdrawal', async () => {
    const world = makeWorld();
    const v1 = await publish(world, V1, 'p-1');
    await world.app.handle(
      req('POST', '/access/grant', { artifactId: v1.id, principalId: STEVE, grant: 'read' }, FARID),
    );
    const stable = `${v1.id}.${BASE}`;
    const pinnedV1 = `${v1.releaseId}.pinned.${BASE}`;
    const anonymous = await get(world, { method: 'GET', host: stable, path: '/' });
    expect(anonymous.status).toBe(401);
    const bogusHost = await get(world, { method: 'GET', host: `www.${BASE}`, path: '/' });
    expect(bogusHost.status).toBe(404);
    const cookie = await activate(world, stable, STEVE, v1.id, v1.releaseId, 'stable');
    const served = await get(world, { method: 'GET', host: stable, path: '/', cookie });
    expect(served.status).toBe(200);
    expect(text(served.bytes)).toBe(V1);
    expect(served.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(served.headers['cache-control']).toBe('no-store');
    const worker = await get(world, { method: 'GET', host: stable, path: '/service-worker.js', cookie });
    expect(worker.status).toBe(404);
    const stolen = await get(world, { method: 'GET', host: stable, path: '/', cookie, actorId: 'mallory' });
    expect(stolen.status).toBe(401);
    // Republish: the stable origin demands fresh version consent.
    const v2 = await publish(world, V2, 'p-2');
    expect(v2.id).toBe(v1.id);
    const staleGrant = await get(world, { method: 'GET', host: stable, path: '/', cookie });
    expect(staleGrant.status).toBe(401);
    // The pinned v1 origin still serves v1 after its own activation.
    const pinnedCookie = await activate(world, pinnedV1, STEVE, v1.id, v1.releaseId, 'pinned');
    const pinnedServed = await get(world, { method: 'GET', host: pinnedV1, path: '/', cookie: pinnedCookie });
    expect(text(pinnedServed.bytes)).toBe(V1);
    // Withdrawal cuts readers off at the next request despite a live grant.
    await world.app.handle(req('POST', '/withdraw', { artifactId: v1.id }, FARID));
    const cut = await get(world, { method: 'GET', host: pinnedV1, path: '/', cookie: pinnedCookie });
    expect(cut.status).toBe(404);
    await world.app.handle(req('POST', '/restore', { artifactId: v1.id }, FARID));
    const back = await get(world, { method: 'GET', host: pinnedV1, path: '/', cookie: pinnedCookie });
    expect(back.status).toBe(200);
    expect(text(back.bytes)).toBe(V1);
  });
});
