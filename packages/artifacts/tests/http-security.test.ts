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

    const app = makeApp({ maxFiles: 2, maxFileBytes: 3, maxTotalBytes: 3 });
    const ensured = await app.handle(req('POST', '/ensure', { bindingName: 'bounded',
      idempotencyKey: 'ensure', parameters: { title: 'Bounded' } }, OWNER));
    const artifactId = (ensured.body as { artifactId: string }).artifactId;
    const file = { path: 'index.html', mimeType: 'text/html', bytes: [1, 2] };
    for (const files of [
      [{ ...file, bytes: [1, 2, 3, 4] }],
      [{ path: file.path, mimeType: file.mimeType, text: 'éé' }],
      [file, { ...file, path: 'second' }], [file, file, file],
    ]) expect((await app.handle(req('POST', '/publish', { artifactId, files }, OWNER))).status).toBe(400);
    expect((await app.handle(req('GET', `/current/${artifactId}`, undefined, OWNER))).status).toBe(404);
    expect((await app.handle(req('POST', '/publish', { artifactId,
      files: [{ ...file, bytes: [1, 2, 3] }] }, OWNER))).status).toBe(201);
  });

  it('should trust host scope and validated parameters instead of body scope or hash', async () => {
    const app = makeApp();
    const body = { bindingName: 'scope-test', storageScopeId: 'forged',
      idempotencyKey: 'same', paramsHash: 'forged', parameters: { title: 'One' } };
    const request = req('POST', '/ensure', body, OWNER);
    expect((await app.handle({ ...request, storageScopeId: undefined })).status).toBe(400);
    const first = await app.handle(request);
    expect(first.status).toBe(201);
    expect((await app.handle({ ...request, body: { ...body, storageScopeId: 'other', paramsHash: 'other' } })).body)
      .toMatchObject({ ...(first.body as object), replayed: true });
    expect((await app.handle({ ...request, storageScopeId: 'other' })).status).toBe(409);
    expect((await app.handle({ ...request, body: { ...body, parameters: { title: 'Two' } } })).status).toBe(409);
    const bob = await app.handle({ ...request, actorId: 'bob' });
    expect(bob.status).toBe(201);
    expect(bob.body).not.toMatchObject({ artifactId: (first.body as { artifactId: string }).artifactId });
  });

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
