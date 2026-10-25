/** Content serving journey through the selected guarded control app. */
import { describe, expect, it } from 'vitest';
import type { HttpRequest } from '../src/http.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { grantAccess } from '../src/server/access.js';
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
  const world = createTransportWorld([FARID, STEVE], 'scope-1');
  const tickets = createTicketService({ store: createMemoryTicketStore() });
  const handler = createContentHandler({
    acls: world.acls, lifecycle: world.lifecycle, publication: world.publication, blobs: world.blobs,
    grants: createHmacGrantSigner({ secret: 'e2e-grant-secret' }), tickets, baseDomain: BASE,
  });
  return { ...world, handler, tickets };
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId, storageScopeId: "scope-1" };
}

type World = ReturnType<typeof makeWorld>;

async function publish(world: World, html: string, key: string): Promise<{ id: string; releaseId: string }> {
  const ensured = await world.app.handle(
    req('POST', '/ensure', {
      bindingName: 'view', storageScopeId: 'scope-1', idempotencyKey: 'e-1',
      parameters: {},
    }, FARID), world.invocation(FARID),
  );
  const id = (ensured.body as { artifactId: string }).artifactId;
  const published = await world.app.handle(
    req('POST', '/publish', {
      artifactId: id, profile: {},
      files: [
        { path: 'index.html', mimeType: 'text/html', bytes: bytes(html) },
        { path: 'service-worker.js', mimeType: 'text/javascript', bytes: bytes('self.x=1') },
      ],
      idempotencyKey: key,
    }, FARID), world.invocation(FARID),
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
  it('should return secured stable errors when a content dependency throws', async () => {
    const world = makeWorld();
    const { id } = await publish(world, V1, 'internal-error');
    world.publication.getCurrent = async () => { throw new Error('private driver details'); };
    for (const method of ['GET', 'HEAD']) {
      const response = await get(world, { method, host: `${id}.${BASE}`, path: '/' });
      expect(response.status).toBe(500);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.body).toEqual(method === 'HEAD' ? undefined : { error: 'internal_error' });
      expect(response.bytes).toBeUndefined();
    }
  });

  it('should omit all HEAD bodies and secure errors and activation responses', async () => {
    const world = makeWorld();
    const { id, releaseId } = await publish(world, V1, 'head');
    const host = `${id}.${BASE}`;
    const issued = await world.tickets.issue({ subjectId: FARID, artifactId: id, releaseId, channel: 'stable' });
    const activation = await get(world, { method: 'HEAD', host, path: '/', actorId: FARID, ticket: issued.ticketId });
    const cookie = activation.headers['set-cookie'];
    expect(activation.status).toBe(200);
    const served = await get(world, { method: 'HEAD', host, path: '/', cookie });
    expect(served.status).toBe(200);
    expect(served.headers['content-length']).toBe(String(bytes(V1).length));
    const errors = await Promise.all([
      get(world, { method: 'GET', host, path: '/' }),
      get(world, { method: 'GET', host: 'invalid', path: '/' }),
      get(world, { method: 'GET', host, path: '/missing', cookie }),
      get(world, { method: 'HEAD', host, path: '/' }),
    ]);
    for (const response of [activation, ...errors]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    }
    for (const response of [activation, served, errors[3]!]) {
      expect(response.body).toBeUndefined();
      expect(response.bytes).toBeUndefined();
    }
  });

  it.each(['stable', 'pinned'] as const)('should refuse a %s ticket on the other channel', async (channel) => {
    const world = makeWorld();
    const v1 = await publish(world, V1, 'p-1');
    const stable = `${v1.id}.${BASE}`;
    const pinned = `${v1.releaseId}.pinned.${BASE}`;
    const issued = await world.tickets.issue({
      subjectId: FARID, artifactId: v1.id, releaseId: v1.releaseId, channel,
    });
    const request = { method: 'GET', path: '/', actorId: FARID, ticket: issued.ticketId };
    const refused = await get(world, { ...request, host: channel === 'stable' ? pinned : stable });
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
    const correct = { ...request, host: channel === 'stable' ? stable : pinned };
    const activated = await get(world, correct);
    expect(activated.status).toBe(200);
    expect(activated.headers['set-cookie']).toContain('__Host-artifacts_grant=');
    expect((await get(world, correct)).status).toBe(401);
  });

  it('should refuse another pinned release without consuming the r1 ticket', async () => {
    const world = makeWorld();
    const v1 = await publish(world, V1, 'p-1');
    const issued = await world.tickets.issue({
      subjectId: FARID, artifactId: v1.id, releaseId: v1.releaseId, channel: 'pinned',
    });
    const v2 = await publish(world, V2, 'p-2');
    const request = { method: 'GET', path: '/', actorId: FARID, ticket: issued.ticketId };
    const refused = await get(world, { ...request, host: `${v2.releaseId}.pinned.${BASE}` });
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
    const host = `${v1.releaseId}.pinned.${BASE}`;
    const activated = await get(world, { ...request, host });
    expect(activated.status).toBe(200);
    const served = await get(world, { method: 'GET', path: '/', host, cookie: activated.headers['set-cookie'] });
    expect(served.status).toBe(200);
    expect(text(served.bytes)).toBe(V1);
  });

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
    const acl = await world.acls.getArtifactAcl(v1.id);
    await world.acls.putArtifactAcl(v1.id, grantAccess(acl!, FARID, { principalId: STEVE, grant: 'read' }));
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
    await world.lifecycle.withdraw(v1.id, FARID);
    const cut = await get(world, { method: 'GET', host: pinnedV1, path: '/', cookie: pinnedCookie });
    expect(cut.status).toBe(404);
    await world.lifecycle.restore(v1.id, FARID);
    const back = await get(world, { method: 'GET', host: pinnedV1, path: '/', cookie: pinnedCookie });
    expect(back.status).toBe(200);
    expect(text(back.bytes)).toBe(V1);
  });
});
