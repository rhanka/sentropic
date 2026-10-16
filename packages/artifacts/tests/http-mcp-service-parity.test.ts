/**
 * L-5c — HTTP/MCP service parity, part 1: ensure + publish (spec-v8 §9 5c).
 * The transport-free HTTP app delegates to the same services as direct
 * calls (401 anonymous, 403 denied, 404 absent, 409 conflict, 422 failed
 * verification, 400 invalid). Artifacts are addressed by server UUID; only
 * ensure takes a binding.
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
import {
  createLifecycleService,
  createMemoryLifecycleStore,
} from '../src/server/lifecycle.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemorySourceStore } from '../src/server/sources.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';

const OWNER = 'owner-1';
const READER = 'reader-1';
const STRANGER = 'stranger-1';
const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);

function makeApp() {
  const kv = createMemoryKv();
  const artifacts = createArtifactService({ kv, uuid: createCryptoUuid() });
  // One shared current pointer for publication and lifecycle (production
  // wires both services to the same adapter on `artifact_current`).
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const publication = createPublicationService({
    state,
    blobs,
    intents: createMemoryIntentStore(),
    idempotency: createIdempotencyStore(createMemoryIdempotencyKv()),
  });
  const app = createHttpArtifactApp({
    parameterSchema: SCHEMA,
    artifacts,
    publication,
    lifecycle: createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00.000Z', state),
    forks: createForkService(createMemoryForkStore()),
    acls: createMemoryAclStore(),
    sources: createMemorySourceStore(),
    blobs,
  });
  return { app, artifacts };
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId };
}

function asId(body: unknown): string {
  return (body as { artifactId: string }).artifactId;
}

async function ensureSite(app: ReturnType<typeof makeApp>['app'], actor = OWNER, key = 'k-1'): Promise<string> {
  const res = await app.handle(
    req('POST', '/ensure', {
      bindingName: 'site',
      storageScopeId: 'scope-1',
      idempotencyKey: key,
      paramsHash: 'h-1',
      parameters: { title: 'Hello' },
    }, actor),
  );
  expect(res.status).toBe(201);
  return asId(res.body);
}

const FILES = [{ path: 'index.html', mimeType: 'text/html', bytes: [1, 2, 3] }];

describe('http service parity', () => {
  it('ensures identically through HTTP and direct calls', async () => {
    const { app, artifacts } = makeApp();
    const direct = await artifacts.ensurePrivateView({
      actorUserId: OWNER,
      ownerId: OWNER,
      storageScopeId: 'scope-1',
      bindingName: 'direct',
      idempotencyKey: 'k-direct',
      paramsHash: 'h-d',
    });
    expect(direct).toMatchObject({ created: true, replayed: false });
    const http = await app.handle(
      req('POST', '/ensure', {
        bindingName: 'site',
        storageScopeId: 'scope-1',
        idempotencyKey: 'k-1',
        paramsHash: 'h-1',
        parameters: { title: 'Hello' },
      }, OWNER),
    );
    expect(http.status).toBe(201);
    expect(http.body).toMatchObject({ created: true, replayed: false });
    expect(typeof asId(http.body)).toBe('string');
    const forged = await app.handle(req('POST', '/ensure', {}, ''));
    expect(forged.status).toBe(401);
    const invalid = await app.handle(
      req('POST', '/ensure', {
        bindingName: 'site',
        storageScopeId: 'scope-1',
        idempotencyKey: 'k-2',
        paramsHash: 'h-2',
        parameters: {},
      }, OWNER),
    );
    expect(invalid.status).toBe(400);
  });

  it('publishes with conflict and verification mapping', async () => {
    const { app } = makeApp();
    const id = await ensureSite(app);
    const grant = await app.handle(
      req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER),
    );
    expect(grant.status).toBe(200);
    const publish = { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'p-1', paramsHash: 'h-1' };
    const first = await app.handle(req('POST', '/publish', publish, OWNER));
    expect(first.status).toBe(201);
    const replay = await app.handle(req('POST', '/publish', publish, OWNER));
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const conflict = await app.handle(
      req('POST', '/publish', { ...publish, paramsHash: 'h-2' }, OWNER),
    );
    expect(conflict.status).toBe(409);
    const badBytes = await app.handle(
      req('POST', '/publish', {
        ...publish,
        files: [{ path: 'x', mimeType: 't', bytes: [256] }],
        idempotencyKey: 'p-9',
        paramsHash: 'h-9',
      }, OWNER),
    );
    expect(badBytes.status).toBe(400);
    const forged = await app.handle(req('POST', '/publish', { ...publish, idempotencyKey: 'p-3' }, READER));
    expect(forged.status).toBe(403);
    const unknown = await app.handle(
      req('POST', '/publish', { ...publish, artifactId: '00000000-0000-4000-8000-000000000000', idempotencyKey: 'p-4' }, OWNER),
    );
    expect(unknown.status).toBe(404);
  });
  it('reads 200/404 without oracling existence', async () => {
    const { app } = makeApp();
    const id = await ensureSite(app);
    await app.handle(req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER));
    await app.handle(req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'p-1', paramsHash: 'h-1' }, OWNER));
    expect((await app.handle(req('GET', `/current/${id}`, undefined, OWNER))).status).toBe(200);
    expect((await app.handle(req('GET', `/current/${id}`, undefined, READER))).status).toBe(200);
    expect((await app.handle(req('GET', '/current/00000000-0000-4000-8000-000000000000', undefined, OWNER))).status).toBe(404);
    await app.handle(req('POST', '/withdraw', { artifactId: id }, OWNER));
    expect((await app.handle(req('GET', `/current/${id}`, undefined, READER))).status).toBe(404);
    expect((await app.handle(req('GET', `/current/${id}`, undefined, OWNER))).status).toBe(200);
    expect((await app.handle(req('GET', `/current/${id}`, undefined, ''))).status).toBe(401);
  });

  it('runs lifecycle, fork, source and grants with status mapping', async () => {
    const { app } = makeApp();
    const id = await ensureSite(app);
    const rel1 = await app.handle(
      req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'pp-1', paramsHash: 'h-1' }, OWNER),
    );
    const rel2 = await app.handle(
      req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'pp-2', paramsHash: 'h-2' }, OWNER),
    );
    const r1 = (rel1.body as { releaseId: string }).releaseId;
    const r2 = (rel2.body as { releaseId: string }).releaseId;
    const rollback = await app.handle(
      req('POST', '/promote', { artifactId: id, releaseId: r1, expectedCurrent: r2 }, OWNER),
    );
    expect(rollback.status).toBe(200);
    const stale = await app.handle(
      req('POST', '/promote', { artifactId: id, releaseId: r2, expectedCurrent: r2 }, OWNER),
    );
    expect(stale.status).toBe(409);
    const grantOther = await app.handle(
      req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, READER),
    );
    expect(grantOther.status).toBe(403);
    await app.handle(req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'source' }, OWNER));
    const forked = await app.handle(req('POST', '/fork', { artifactId: id }, READER));
    expect(forked.status).toBe(201);
    expect(asId(forked.body)).not.toBe(id);
    const strangerFork = await app.handle(req('POST', '/fork', { artifactId: id }, STRANGER));
    expect(strangerFork.status).toBe(403);
    const noSource = await app.handle(req('GET', `/source/${id}`, undefined, READER));
    expect(noSource.status).toBe(404);
    const strangerSource = await app.handle(req('GET', `/source/${id}`, undefined, STRANGER));
    expect(strangerSource.status).toBe(403);
    const putBadSource = await app.handle(
      req('POST', '/sources', { artifactId: id, source: { kind: 'recipe', steps: [] } }, OWNER),
    );
    expect(putBadSource.status).toBe(400);
    await app.handle(req('POST', '/sources', { artifactId: id, source: { kind: 'base-commit', commit: 'abc' } }, OWNER));
    const sourceRead = await app.handle(req('GET', `/source/${id}`, undefined, READER));
    expect(sourceRead.status).toBe(200);
    expect(sourceRead.body).toEqual({ kind: 'base-commit', commit: 'abc' });
    const dupGrant = await app.handle(
      req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER),
    );
    expect(dupGrant.status).toBe(400);
    const renew = await app.handle(req('POST', '/renew', { artifactId: id }, OWNER));
    expect(renew.status).toBe(200);
    const revoked = await app.handle(
      req('POST', '/access/revoke', { artifactId: id, principalId: READER }, OWNER),
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await app.handle(req('GET', `/source/${id}`, undefined, READER));
    expect(afterRevoke.status).toBe(403);
    const unknownRoute = await app.handle(req('GET', '/nope', undefined, OWNER));
    expect(unknownRoute.status).toBe(404);
    const purgeEarly = await app.handle(req('POST', '/purge', { artifactId: id }, OWNER));
    expect(purgeEarly.status).toBe(409);
    await app.handle(req('POST', '/delete', { artifactId: id }, OWNER));
    const purged = await app.handle(req('POST', '/purge', { artifactId: id }, OWNER));
    expect(purged.status).toBe(200);
    expect((await app.handle(req('GET', `/current/${id}`, undefined, OWNER))).status).toBe(404);
    const forkGone = await app.handle(req('POST', '/fork', { artifactId: id }, OWNER));
    expect(forkGone.status).toBe(410);
  });

  it('serves content bytes with status mapping', async () => {
    const { app } = makeApp();
    const id = await ensureSite(app);
    await app.handle(req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER));
    await app.handle(req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'c-1', paramsHash: 'h-1' }, OWNER));
    const current = await app.handle(req('GET', `/current/${id}`, undefined, OWNER));
    const manifest = JSON.parse((current.body as { manifest: string }).manifest) as {
      files: { digest: string }[];
    };
    const digest = manifest.files[0]?.digest ?? '';
    const served = await app.handle(req('GET', `/content/${id}/${digest}`, undefined, READER));
    expect(served.status).toBe(200);
    expect(served.body).toMatchObject({ digest, mimeType: 'text/html', size: 3, bytes: [1, 2, 3] });
    const stranger = await app.handle(req('GET', `/content/${id}/${digest}`, undefined, STRANGER));
    expect(stranger.status).toBe(403);
    const noBlob = await app.handle(
      req('GET', `/content/${id}/sha256:${'0'.repeat(64)}`, undefined, OWNER),
    );
    expect(noBlob.status).toBe(404);
  });
});
