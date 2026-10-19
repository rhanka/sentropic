/**
 * L-5e — pilot contract (spec-v8 §9 5e UAT, service level): guide →
 * template → ensure → publish → rediscover in a fresh session → share →
 * fork → promote/rollback → delete → restore, entirely through the
 * artifacts_* tools over injected in-memory ports. Live Radar hosting,
 * browser and hosted-client receipts remain Radar-side acceptance.
 */
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp } from '../src/http.js';
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
import { createMemoryStaging, createUploadService } from '../src/server/uploads.js';
import { createDefaultTemplateCatalog } from '../src/server/templates.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';
import { createArtifactsToolExecutor, type ArtifactsInvokeInput } from '../src/mcp-core.js';

const FARID = 'farid';
const STEVE = 'steve';
const THIRD = 'third-party';
type Executor = ReturnType<typeof createArtifactsToolExecutor>;

function makeWorld() {
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const staging = createMemoryStaging();
  const app = createHttpArtifactApp({
    parameterSchema: defineParameters([{ key: 'title', type: 'string', required: true }]),
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
    uploads: createUploadService(staging, { maxUploadBytes: 65536 }),
    staging,
    templates: createDefaultTemplateCatalog(),
  });
  const session = () => createArtifactsToolExecutor({ app, defaultStorageScopeId: 'scope-pilot' });
  return { session };
}

async function call(
  executor: Executor,
  tool: string,
  actorId: string,
  args: Record<string, unknown>,
  status: number,
) {
  const input: ArtifactsInvokeInput = { tool, actorId, args };
  const res = await executor.invoke(input);
  expect(res.status, tool).toBe(status);
  return res.body as Record<string, unknown>;
}

const toBytes = (text: string): number[] => [...new TextEncoder().encode(text)];

describe('pilot contract', () => {
  it('runs the full publish/share/fork/withdraw/undo journey through tools', async () => {
    const { session } = makeWorld();
    const s1 = session();
    const guide = await call(s1, 'artifacts_get_api_guide', FARID, {}, 200);
    expect(guide['version']).toBe('v1');
    const template = await call(s1, 'artifacts_get_template', FARID, { templateId: 'static-html' }, 200);
    const ensured = await call(s1, 'artifacts_ensure', FARID, {
      bindingName: 'pilot-view', idempotencyKey: 'e-1', paramsHash: 'h-1',
      parameters: { title: 'Pilot view' },
    }, 201);
    const id = ensured['artifactId'] as string;
    const kitFiles = (template['files'] as Array<{ path: string; content: string }>).map((file) => ({
      path: file.path,
      mimeType: file.path.endsWith('.html') ? 'text/html' : 'text/plain',
      bytes: toBytes(file.content),
    }));
    const v1 = await call(s1, 'artifacts_publish', FARID, {
      artifactId: id, files: kitFiles, source: { kind: 'inline-original' },
      idempotencyKey: 'p-1', paramsHash: 'h-1',
    }, 201);
    // Rediscover from a fresh session over the same world.
    const s2 = session();
    const listed = await call(s2, 'artifacts_list', FARID, {}, 200);
    expect(listed['total']).toBe(1);
    // Share with Steve (read only); a third party stays refused.
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'read',
    }, 200);
    await call(s2, 'artifacts_get', STEVE, { artifactId: id }, 200);
    await call(s2, 'artifacts_get', THIRD, { artifactId: id }, 404);
    await call(s2, 'artifacts_get_source', STEVE, { artifactId: id }, 403);
    // Steve forks privately; the fork survives the parent lifecycle.
    const forked = await call(s2, 'artifacts_fork', STEVE, { artifactId: id }, 201);
    const forkId = forked['artifactId'] as string;
    expect(forkId).not.toBe(id);
    // Publish v2, roll back to v1 explicitly.
    const v2 = await call(s2, 'artifacts_publish', FARID, {
      artifactId: id,
      files: [{ path: 'index.html', mimeType: 'text/html', bytes: toBytes('<h1>v2</h1>') }],
      idempotencyKey: 'p-2', paramsHash: 'h-2',
    }, 201);
    await call(s2, 'artifacts_promote', FARID, {
      artifactId: id, releaseId: v1['releaseId'], expectedCurrent: v2['releaseId'],
    }, 200);
    const meta = await call(s2, 'artifacts_get', FARID, { artifactId: id }, 200);
    expect(meta['currentReleaseId']).toBe(v1['releaseId']);
    // Grant source, export, then withdraw and undo before purge.
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'source',
    }, 400); // duplicate principal grant refused; revoke then re-grant
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'revoke', principalId: STEVE,
    }, 200);
    await call(s2, 'artifacts_set_access', FARID, {
      artifactId: id, action: 'grant', principalId: STEVE, grant: 'source',
    }, 200);
    const source = await call(s2, 'artifacts_get_source', STEVE, { artifactId: id }, 200);
    expect(source).toEqual({ kind: 'inline-original' });
    await call(s2, 'artifacts_delete', FARID, { artifactId: id }, 200);
    const restored = await call(s2, 'artifacts_restore', FARID, { artifactId: id }, 200);
    expect(restored['state']).toBe('active');
    const after = await call(s2, 'artifacts_get', STEVE, { artifactId: id }, 200);
    expect(after['state']).toBe('active');
  });
});
