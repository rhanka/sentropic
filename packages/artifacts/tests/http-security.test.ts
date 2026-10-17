/**
 * m5 — artifacts HTTP hardening (final review minor m5): error bodies are
 * stable codes, never raw internal messages; an actor with no read access
 * cannot distinguish an existing artifact from an unknown one (no 404/403
 * existence oracle); source payloads are parsed without unchecked casts.
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
import { createMemorySourceStore, parseSourceRef } from '../src/server/sources.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';

const OWNER = 'owner-1';
const READER = 'reader-1';
const STRANGER = 'stranger-1';
const MISSING = '00000000-0000-4000-8000-000000000000';
const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);
const FILES = [{ path: 'index.html', mimeType: 'text/html', bytes: [1, 2, 3] }];

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
  });
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId };
}

async function seeded() {
  const app = makeApp();
  const ensured = await app.handle(
    req('POST', '/ensure', {
      bindingName: 'site', storageScopeId: 'scope-1', idempotencyKey: 'k-1',
      paramsHash: 'h-1', parameters: { title: 'Hello' },
    }, OWNER),
  );
  const id = (ensured.body as { artifactId: string }).artifactId;
  await app.handle(req('POST', '/access/grant', { artifactId: id, principalId: READER, grant: 'read' }, OWNER));
  await app.handle(req('POST', '/publish', {
    artifactId: id, profile: {}, files: FILES, idempotencyKey: 'p-1', paramsHash: 'h-1',
  }, OWNER));
  const current = await app.handle(req('GET', `/current/${id}`, undefined, OWNER));
  const manifest = JSON.parse((current.body as { manifest: string }).manifest) as {
    files: { digest: string }[];
  };
  return { app, id, digest: manifest.files[0]?.digest ?? '' };
}

describe('http security (m5)', () => {
  it('gives strangers identical 404 answers for existing and unknown artifacts', async () => {
    const { app, id, digest } = await seeded();
    const attempts: Array<[string, string, unknown]> = [
      ['POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'x-1' }],
      ['POST', '/fork', { artifactId: id }],
      ['POST', '/withdraw', { artifactId: id }],
      ['POST', '/access/grant', { artifactId: id, principalId: STRANGER, grant: 'read' }],
      ['POST', '/sources', { artifactId: id, source: { kind: 'inline-original' } }],
      ['GET', `/source/${id}`, undefined],
      ['GET', `/content/${id}/${digest}`, undefined],
      ['GET', `/current/${id}`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const existing = await app.handle(req(method, path, body, STRANGER));
      const unknownPath = path.replace(id, MISSING);
      const unknownBody =
        typeof body === 'object' && body !== null
          ? { ...(body as Record<string, unknown>), artifactId: MISSING }
          : body;
      const unknown = await app.handle(req(method, unknownPath, unknownBody, STRANGER));
      expect(existing.status, `${method} ${path}`).toBe(404);
      expect(existing, `${method} ${path}`).toEqual(unknown);
    }
  });

  it('keeps precise 403 answers for actors who can already read the artifact', async () => {
    const { app, id } = await seeded();
    const publish = await app.handle(
      req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'x-2' }, READER),
    );
    expect(publish.status).toBe(403);
    const source = await app.handle(req('GET', `/source/${id}`, undefined, READER));
    expect(source.status).toBe(403);
    const grant = await app.handle(
      req('POST', '/access/grant', { artifactId: id, principalId: STRANGER, grant: 'read' }, READER),
    );
    expect(grant.status).toBe(403);
  });

  it('returns stable error codes and never raw internal messages', async () => {
    const { app, id } = await seeded();
    const notFound = await app.handle(req('GET', `/current/${MISSING}`, undefined, OWNER));
    expect(notFound.body).toEqual({ error: 'not_found' });
    const denied = await app.handle(
      req('POST', '/publish', { artifactId: id, profile: {}, files: FILES, idempotencyKey: 'x-3' }, READER),
    );
    expect(denied.body).toEqual({ error: 'access_denied' });
    const invalid = await app.handle(req('POST', '/ensure', { bindingName: 'x' }, OWNER));
    expect(invalid.body).toEqual({ error: 'invalid_request' });
    const conflict = await app.handle(req('POST', '/purge', { artifactId: id }, OWNER));
    expect(conflict.body).toEqual({ error: 'conflict' });
    for (const res of [notFound, denied, invalid, conflict]) {
      expect(JSON.stringify(res.body)).not.toContain(id);
      expect(JSON.stringify(res.body)).not.toContain('artifact:');
    }
  });

  it('parses source refs fail-closed without unchecked casts', () => {
    expect(parseSourceRef({ kind: 'inline-original' })).toEqual({ kind: 'inline-original' });
    expect(parseSourceRef({ kind: 'base-commit', commit: 'abc' })).toEqual({
      kind: 'base-commit', commit: 'abc',
    });
    expect(parseSourceRef({ kind: 'recipe', steps: ['build'] })).toEqual({
      kind: 'recipe', steps: ['build'],
    });
    expect(() => parseSourceRef({ kind: 'base-commit' })).toThrow(/invalid source/);
    expect(() => parseSourceRef({ kind: 'recipe', steps: [42] })).toThrow(/invalid source/);
    expect(() => parseSourceRef({ kind: 'nope' })).toThrow(/invalid source/);
    expect(() => parseSourceRef('inline-original')).toThrow(/invalid source/);
    expect(() => parseSourceRef(undefined)).toThrow(/invalid source/);
  });
});
