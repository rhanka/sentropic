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
  it('should expose and execute nothing for an empty selection', async () => {
    const app = boundary(compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: [] }));
    expect(Object.isFrozen(app.selectedCapabilities)).toBe(true);
    expect(app.selectedCapabilities).toEqual([]);
    expect(await app.handle({ method: 'POST', path: '/ensure', body: {}, actorId: 'alice' }, invocation))
      .toEqual({ status: 503, body: { error: 'capability_unavailable' } });
  });
  it.each([{ paramsHash: 'forged' }, { actorId: 'mallory' }, { authorizeCommit: true },
    { source: { kind: 'inline-original' } }])('should reject trusted body injection %j', async (extra) => {
    const outcome = await boundary().execute({ method: 'POST', path: '/ensure', actorId: 'alice',
      body: { bindingName: 'site', idempotencyKey: 'key', ...extra } }, invocation);
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'invalid_request', httpStatus: 400 } });
  });
  it('should filter foreign scope and unreadable artifacts before pagination', async () => {
    const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003'];
    const acls = createMemoryAclStore();
    for (let i = 0; i < ids.length; i += 1) await acls.putArtifactAcl(ids[i], {
      ownerId: 'alice', storageScopeId: i === 0 ? 'foreign' : 'scope-1', grants: [], isPublic: false, withdrawn: false,
    });
    const app = boundary(profile, { acls, lifecycle: { stateOf: async () => 'active', canRead: () => true } });
    const result = await app.handle({ method: 'POST', path: '/list', body: { offset: 1, limit: 1 }, actorId: 'alice' }, invocation);
    expect(result).toMatchObject({ status: 200, body: { total: 2, artifacts: [{ artifactId: ids[2] }] } });
  });
  it('should quarantine legacy successes through the actual app without dispatching a replacement', async () => {
    const keys: string[] = [];
    const app = boundary(profile, { legacyRecords: { get: async (key) => {
      keys.push(key);
      return '{"params_hash":"legacy","result":{"artifactId":"old"}}';
    } } });
    const outcome = await app.execute({ method: 'POST', path: '/ensure', actorId: 'alice',
      body: { bindingName: 'site', idempotencyKey: 'original-key' } }, invocation);
    expect(outcome).toMatchObject({ ok: false, failure: {
      httpStatus: 503, variant: 'legacy_quarantine', retriable: false, commitState: 'not_committed',
    } });
    expect(keys).toHaveLength(1);
  });
  it('should reject actor and scope disagreement before provider dispatch', async () => {
    const app = boundary();
    for (const extra of [{ actorId: 'mallory' }, { storageScopeId: 'foreign' }]) {
      expect(await app.handle({ method: 'POST', path: '/ensure', actorId: 'alice',
        body: { bindingName: 'site', idempotencyKey: 'key' }, ...extra }, invocation))
        .toEqual({ status: 400, body: { error: 'invalid_request' } });
    }
  });
});
