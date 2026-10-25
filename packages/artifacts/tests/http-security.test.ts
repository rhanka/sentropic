/** Closed effective inputs and typed, redacted outcomes through the actual app. */
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp, projectArtifactHttpOutcome, type HttpAppDeps } from '../src/http.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createRadarKeyDerivation } from '../src/server/command-identity.js';
import type { ArtifactInvocationContext } from '../src/server/commit-contract.js';
import { parseSourceRef } from '../src/server/sources.js';

const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const invocation: ArtifactInvocationContext = Object.freeze({ invocationId: 'security-1', actorId: 'alice',
  storageScopeId: 'scope-1', authorizeCommit: async () => { throw new Error('unexpected guard'); } });
const artifactId = '00000000-0000-4000-8000-000000000001';
function appWithFailure(cause: unknown = new Error('unexpected storage call')) {
  const fail = async () => { throw cause; };
  return createHttpArtifactApp({ profile, coordinator: { finalizePrepared: fail, replayPrepared: fail },
    derivation: createRadarKeyDerivation({ storageScopeId: 'scope-1', actorIds: ['alice'] }),
    legacyRecords: { get: fail },
    ensureHost: { readPolicyRevision: fail },
    acls: { getArtifactAcl: fail, listArtifactIds: fail }, lifecycle: { stateOf: fail },
  } as unknown as HttpAppDeps);
}
const files = [{ path: 'index.html', mimeType: 'text/html', text: 'hello' }];

describe('HTTP effective-profile security', () => {
  it.each([
    { idempotencyKey: '' }, { idempotencyKey: ' ' }, { idempotencyKey: 'x'.repeat(257) },
    { idempotencyKey: '\ud800' }, { ownerId: 'mallory' }, { actorId: 'mallory' },
    { paramsHash: 'forged' }, { internalKey: 'forged' }, { tenantId: 'foreign' },
    { authorizeCommit: true }, { files: [] }, { files: Array(33).fill(files[0]) },
    { files: [{ ...files[0], bytes: [1] }] }, { files: [{ ...files[0], text: undefined, bytes: [256] }] },
    { files: [{ ...files[0], text: 'x'.repeat(262145) }] },
    { files: [{ ...files[0], path: 'other' }, { ...files[0], text: 'é'.repeat(131073) }] },
    { files: [{ ...files[0], mimeType: 'image/svg+xml' }] },
    { files: [{ ...files[0], path: 'x:y' }] }, { files: [{ ...files[0], path: 'api/x' }] },
    { files: [{ ...files[0], path: 'x\u007f' }] }, { files: [{ ...files[0], path: '../x' }] },
    { source: { kind: 'inline-original' } }, { profile: { nested: {} } },
  ])('should refuse malformed publication before storage: %j', async (extra) => {
    const outcome = await appWithFailure().execute({ method: 'POST', path: '/publish', actorId: 'alice',
      body: { artifactId, idempotencyKey: 'key', files, ...extra } }, invocation);
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'invalid_request',
      httpStatus: 400, retriable: false, commitState: 'not_committed' } });
  });
  it.each(['57P06', '40001', '40P01', '57014', '55P03', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE'])(
    'should retain and redact typed provider failure %s on a read', async (code) => {
      const cause = Object.assign(new Error('private pool URI and driver text'), { code });
      const outcome = await appWithFailure(cause).execute({ method: 'POST', path: '/list', body: {}, actorId: 'alice' }, invocation);
      expect(outcome).toMatchObject({ ok: false, failure: { category: 'provider_unavailable', retriable: true } });
      if (outcome.ok) throw new Error('failure expected');
      expect(outcome.failure.cause).toBe(cause);
      expect(JSON.stringify(outcome)).not.toContain('private pool');
      expect(projectArtifactHttpOutcome(outcome)).toEqual({ status: 503, body: { error: 'capability_unavailable' } });
    });
  it('should preserve unknown provider errors as sanitized internal failures', async () => {
    const cause = new Error('timeout conflict private actor');
    const outcome = await appWithFailure(cause).execute({ method: 'POST', path: '/list', body: {}, actorId: 'alice' }, invocation);
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'provider_error', httpStatus: 500, retriable: false } });
    expect(projectArtifactHttpOutcome(outcome)).toEqual({ status: 500, body: { error: 'internal_error' } });
  });
  it('should refuse forged or incomplete source records', () => {
    for (const source of [{ kind: 'recipe', steps: [] }, { kind: 'unknown' }, { kind: 'base-commit' }]) {
      expect(() => parseSourceRef(source)).toThrow();
    }
  });
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
