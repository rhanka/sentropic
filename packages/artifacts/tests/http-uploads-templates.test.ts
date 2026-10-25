/** Auxiliary routes stay unselected in the Radar transport composition. */
import { expect, it, vi } from 'vitest';
import { createHttpArtifactApp, type HttpAppDeps } from '../src/http.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createRadarKeyDerivation } from '../src/server/command-identity.js';

it.each([
  ['POST', '/uploads/begin'], ['POST', '/uploads/complete'],
  ['POST', '/upload_begin'], ['POST', '/upload_complete'],
  ['POST', '/clone_from_template'], ['POST', '/set_public_template'],
  ['GET', '/templates'], ['GET', '/template/template-id'],
  ['POST', '/get_template'], ['POST', '/get_api_guide'],
  ['POST', '/fork'], ['POST', '/withdraw'],
])('should refuse unselected auxiliary route %s %s before storage', async (method, path) => {
  const storage = vi.fn(() => { throw new Error('unselected dispatch'); });
  const app = createHttpArtifactApp({
    profile: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
    coordinator: { finalizePrepared: storage, replayPrepared: storage },
    derivation: createRadarKeyDerivation({ storageScopeId: 'scope', actorIds: ['owner'] }),
    legacyRecords: { get: storage },
    ensureHost: { lockBinding: storage, resolveBinding: storage,
      abandonAttempt: storage, readPolicyRevision: storage },
    publication: {}, acls: {}, lifecycle: {},
  } as unknown as HttpAppDeps);
  const outcome = await app.execute({ method, path, body: {}, actorId: 'owner' }, {
    invocationId: 'auxiliary', actorId: 'owner', storageScopeId: 'scope', authorizeCommit: storage,
  });
  expect(outcome).toMatchObject({ ok: false, failure: {
    category: 'capability_unselected', phase: 'selection', httpStatus: 503,
    publicCode: 'capability_unavailable', retriable: false, commitState: 'not_committed',
  } });
  expect(storage).not.toHaveBeenCalled();
});
