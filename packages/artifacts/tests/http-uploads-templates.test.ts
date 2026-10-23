/**
 * L-5e (B3) — bounded upload routes and the template/api-guide catalog
 * backing artifacts_create_upload / artifacts_commit_upload /
 * artifacts_get_template / artifacts_get_api_guide. Large bytes move over
 * bounded upload sessions, never as unbounded tool payloads.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp, type HttpRequest } from '../src/http.js';
import { createArtifactService } from '../src/server/service.js';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
  type PublicationLimits,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../src/server/lifecycle.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemorySourceStore } from '../src/server/sources.js';
import { createMemoryStaging, createUploadService } from '../src/server/uploads.js';
import { createDefaultTemplateCatalog } from '../src/server/templates.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);
const HI = [104, 105];
const HI_DIGEST = `sha256:${createHash('sha256').update(new Uint8Array(HI)).digest('hex')}`;

function makeApp(withExtras = true, limits?: Partial<PublicationLimits>, staging = createMemoryStaging()) {
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
      limits,
    }),
    lifecycle: createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00.000Z', state),
    forks: createForkService(createMemoryForkStore()),
    acls: createMemoryAclStore(),
    sources: createMemorySourceStore(),
    blobs,
    ...(withExtras
      ? {
          uploads: createUploadService(staging, { maxUploadBytes: 1024 }),
          staging,
          templates: createDefaultTemplateCatalog(),
        }
      : {}),
  });
}

function req(method: string, path: string, body: unknown, actorId: string): HttpRequest {
  return { method, path, body, actorId, storageScopeId: "scope-1" };
}

async function seededId(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.handle(
    req('POST', '/ensure', {
      bindingName: 'site', storageScopeId: 'scope-1', idempotencyKey: 'k-1',
      paramsHash: 'h-1', parameters: { title: 'Hi' },
    }, OWNER),
  );
  return (res.body as { artifactId: string }).artifactId;
}

describe('http uploads + templates routes', () => {
  it.each([1, 2])('should publish only the verified snapshot when an append overlaps commit size %i', async (size) => {
    const memory = createMemoryStaging();
    let pauseNextRead = false;
    let captured!: () => void;
    let resume!: () => void;
    const capturedRead = new Promise<void>((resolve) => { captured = resolve; });
    const continueRead = new Promise<void>((resolve) => { resume = resolve; });
    const staging = {
      ...memory,
      async read(uploadId: string) {
        const snapshot = await memory.read(uploadId);
        if (pauseNextRead) {
          pauseNextRead = false;
          captured();
          await continueRead;
        }
        return snapshot;
      },
    };
    const app = makeApp(true, undefined, staging);
    const artifactId = await seededId(app);
    const begun = await app.handle(req('POST', '/uploads', { artifactId, mimeType: 'text/plain' }, OWNER));
    const { uploadId } = begun.body as { uploadId: string };
    expect((await app.handle(req('POST', '/uploads/append', {
      uploadId, offset: 0, bytes: [HI[0]!],
    }, OWNER))).status).toBe(200);
    const digest = `sha256:${createHash('sha256').update(new Uint8Array(HI.slice(0, size))).digest('hex')}`;
    const input = { artifactId, uploadId, path: 'hi.txt', mimeType: 'text/plain', digest, size };
    pauseNextRead = true;
    const committing = app.handle(req('POST', '/uploads/commit', input, OWNER));
    await capturedRead;
    const appended = await app.handle(req('POST', '/uploads/append', {
      uploadId, offset: 1, bytes: [HI[1]!],
    }, OWNER));
    resume();
    expect([200, 409]).toContain(appended.status);
    const result = await committing;
    if (result.status === 201) {
      expect(JSON.parse((result.body as { manifest: string }).manifest).files)
        .toEqual([{ path: 'hi.txt', mimeType: 'text/plain', digest, size }]);
      await expect(async () => memory.read(uploadId)).rejects.toThrow(/unknown upload/);
    } else {
      expect(result.status).toBe(422);
      expect((await app.handle(req('GET', `/current/${artifactId}`, undefined, OWNER))).status).toBe(404);
      if (appended.status === 409) {
        expect(await memory.read(uploadId)).toEqual(new Uint8Array([HI[0]!]));
        expect((await app.handle(req('POST', '/uploads/append', {
          uploadId, offset: 1, bytes: [HI[1]!],
        }, OWNER))).status).toBe(200);
      }
      expect((await app.handle(req('POST', '/uploads/commit', {
        ...input, digest: HI_DIGEST, size: 2,
      }, OWNER))).status).toBe(201);
    }
  });

  it.each([{ path: '../rejected' }, { path: '' }, { mimeType: 'text/\nplain' }, { mimeType: '' }])(
    'should preserve a staged upload after rejected publication metadata %j', async (invalid) => {
      const staging = createMemoryStaging();
      const app = makeApp(true, undefined, staging);
      const artifactId = await seededId(app);
      const begun = await app.handle(req('POST', '/uploads', { artifactId, mimeType: 'text/plain' }, OWNER));
      const { uploadId } = begun.body as { uploadId: string };
      expect((await app.handle(req('POST', '/uploads/append', { uploadId, offset: 0, bytes: HI }, OWNER))).status)
        .toBe(200);
      const input = { artifactId, uploadId, path: 'valid.txt', mimeType: 'text/plain', digest: HI_DIGEST, size: 2 };
      expect((await app.handle(req('POST', '/uploads/commit', { ...input, ...invalid }, OWNER))).status).toBe(400);
      expect((await app.handle(req('GET', `/current/${artifactId}`, undefined, OWNER))).status).toBe(404);
      expect(await staging.read(uploadId)).toEqual(new Uint8Array(HI));
      expect((await app.handle(req('POST', '/uploads/commit', input, OWNER))).status).toBe(201);
      await expect(async () => staging.read(uploadId)).rejects.toThrow(/unknown upload/);
      expect((await app.handle(req('POST', '/uploads/commit', input, OWNER))).status).toBe(409);
    },
  );

  it.each([{ maxFileBytes: 2, maxTotalBytes: 4 }, { maxFileBytes: 4, maxTotalBytes: 2 }])(
    'should bound cumulative upload bytes before decoding with limits %j', async (limits) => {
      const app = makeApp(true, limits);
      const artifactId = await seededId(app);
      const begun = await app.handle(req('POST', '/uploads', {
        artifactId, mimeType: 'text/plain', maxSize: 1000,
      }, OWNER));
      const { uploadId } = begun.body as { uploadId: string };
      const append = (offset: number, bytes: number[]) => app.handle(req('POST', '/uploads/append',
        { uploadId, offset, bytes }, OWNER));
      expect((await append(0, [HI[0]!])).status).toBe(200);
      let decoded = false;
      const oversized = [1, 2];
      Object.defineProperty(oversized, 0, { get: () => { decoded = true; return 1; } });
      expect((await append(1, oversized)).status).toBe(400);
      expect(decoded).toBe(false);
      expect(await append(1, [HI[1]!])).toEqual({ status: 200, body: { size: 2 } });
      expect((await append(2, [3])).status).toBe(400);
      expect((await app.handle(req('POST', '/uploads/commit', {
        artifactId, uploadId, path: 'hi.txt', mimeType: 'text/plain', digest: HI_DIGEST, size: 2,
      }, OWNER))).status).toBe(201);
    },
  );

  it('should refuse an oversized upload chunk before changing staged bytes', async () => {
    const app = makeApp(true, { maxFileBytes: 1, maxTotalBytes: 1 });
    const artifactId = await seededId(app);
    const begun = await app.handle(req('POST', '/uploads', { artifactId, mimeType: 'text/plain' }, OWNER));
    const { uploadId } = begun.body as { uploadId: string };
    const append = (bytes: number[]) => app.handle(req('POST', '/uploads/append',
      { uploadId, offset: 0, bytes }, OWNER));
    expect((await append([1, 2])).status).toBe(400);
    expect(await append([1])).toEqual({ status: 200, body: { size: 1 } });
  });

  it('serves the generic template kit and the versioned api guide', async () => {
    const app = makeApp();
    const template = await app.handle(req('GET', '/templates/static-html', undefined, OWNER));
    expect(template.status).toBe(200);
    const body = template.body as { templateId: string; files: { path: string; content: string }[]; buildRecipe: string[] };
    expect(body.templateId).toBe('static-html');
    expect(body.files.map((f) => f.path)).toContain('index.html');
    expect(body.buildRecipe.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.files)).not.toMatch(/secret|api[_-]?key|bearer/i);
    const missing = await app.handle(req('GET', '/templates/nope', undefined, OWNER));
    expect(missing.status).toBe(404);
    const guide = await app.handle(req('GET', '/api-guide', undefined, OWNER));
    expect(guide.status).toBe(200);
    expect(guide.body).toMatchObject({ version: 'v1' });
    expect((guide.body as { markdown: string }).markdown).toContain('artifacts_publish');
    const badGuide = await app.handle(req('GET', '/api-guide/v99', undefined, OWNER));
    expect(badGuide.status).toBe(404);
    const anon = await app.handle(req('GET', '/templates/static-html', undefined, ''));
    expect(anon.status).toBe(401);
  });

  it('runs a bounded upload session into a published release', async () => {
    const app = makeApp();
    const id = await seededId(app);
    const stranger = await app.handle(
      req('POST', '/uploads', { artifactId: id, mimeType: 'text/plain' }, STRANGER),
    );
    expect(stranger.status).toBe(404);
    const begun = await app.handle(
      req('POST', '/uploads', { artifactId: id, mimeType: 'text/plain' }, OWNER),
    );
    expect(begun.status).toBe(201);
    const uploadId = (begun.body as { uploadId: string }).uploadId;
    const badOffset = await app.handle(
      req('POST', '/uploads/append', { uploadId, offset: 3, bytes: HI }, OWNER),
    );
    expect(badOffset.status).toBe(400);
    const foreign = await app.handle(
      req('POST', '/uploads/append', { uploadId, offset: 0, bytes: HI }, STRANGER),
    );
    expect(foreign.status).toBe(404);
    const appended = await app.handle(
      req('POST', '/uploads/append', { uploadId, offset: 0, bytes: HI }, OWNER),
    );
    expect(appended.body).toEqual({ size: 2 });
    const commit = {
      artifactId: id, uploadId, path: 'hi.txt', mimeType: 'text/plain',
      digest: HI_DIGEST, size: 2, idempotencyKey: 'u-1', paramsHash: 'h-1',
    };
    const wrongDigest = await app.handle(
      req('POST', '/uploads/commit', { ...commit, digest: `sha256:${'0'.repeat(64)}` }, OWNER),
    );
    expect(wrongDigest.status).toBe(422);
    const committed = await app.handle(req('POST', '/uploads/commit', commit, OWNER));
    expect(committed.status).toBe(201);
    const current = await app.handle(req('GET', `/current/${id}`, undefined, OWNER));
    const manifest = JSON.parse((current.body as { manifest: string }).manifest) as {
      files: { path: string }[];
    };
    expect(manifest.files.map((f) => f.path)).toEqual(['hi.txt']);
    const again = await app.handle(req('POST', '/uploads/commit', commit, OWNER));
    expect(again.status).toBe(409);
  });

  it('refuses upload and template routes when the host wired no ports', async () => {
    const app = makeApp(false);
    const id = await seededId(app);
    const upload = await app.handle(
      req('POST', '/uploads', { artifactId: id, mimeType: 'text/plain' }, OWNER),
    );
    expect(upload.status).toBe(400);
    const template = await app.handle(req('GET', '/templates/static-html', undefined, OWNER));
    expect(template.status).toBe(400);
  });
});
