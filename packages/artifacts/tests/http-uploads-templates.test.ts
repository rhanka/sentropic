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

function makeApp(withExtras = true, limits?: Partial<PublicationLimits>) {
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const staging = createMemoryStaging();
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
