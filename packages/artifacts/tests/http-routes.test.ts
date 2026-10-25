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
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import type { HttpAppDeps } from '../src/http.js';
import type { ArtifactInvocationContext } from '../src/server/commit/types.js';

describe('L6 selected transport boundary', () => {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const invocation: ArtifactInvocationContext = Object.freeze({
    invocationId: 'transport-1', actorId: 'alice', storageScopeId: 'scope-1',
    authorizeCommit: async () => ({ allowed: false, reason: 'revoked', status: 403,
      publicCode: 'access_denied', retriable: false }),
  });
  function boundary(selected = profile, extra: Partial<HttpAppDeps> = {}) {
    const unexpected = () => { throw new Error('unexpected provider call'); };
    return createHttpArtifactApp({ profile: selected,
      coordinator: { finalizePrepared: unexpected, replayPrepared: unexpected },
      derivation: { algorithm: 'radar-derive-idempotency-v1', derive: unexpected },
      legacyRecords: { get: unexpected },
      ensureHost: { readPolicyRevision: unexpected },
      publication: { getCurrent: unexpected },
      acls: { getArtifactAcl: unexpected, listArtifactIds: unexpected },
      lifecycle: { stateOf: unexpected },
      ...extra,
    } as unknown as HttpAppDeps);
  }
  it('should require an explicit compiled profile and coordinator at startup', () => {
    expect(() => createHttpArtifactApp({} as HttpAppDeps)).toThrow();
    expect(() => createHttpArtifactApp({ profile } as HttpAppDeps)).toThrow();
  });
  it.each([['POST', '/delete'], ['GET', '/current/x'], ['GET', '/ensure'],
    ['POST', '/meta/00000000-0000-4000-8000-000000000001']])(
    'should refuse unsupported route %s %s before storage', async (method, path) => {
      const app = boundary();
      const outcome = await app.execute({ method, path, body: {}, actorId: 'alice' }, invocation);
      expect(outcome).toMatchObject({ ok: false, failure: { category: 'capability_unselected',
        phase: 'selection', commitState: 'not_committed', retriable: false, invocationId: 'transport-1' } });
      expect(await app.handle({ method, path, body: {}, actorId: 'alice' }, invocation))
        .toEqual({ status: 503, body: { error: 'capability_unavailable' } });
    });
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
