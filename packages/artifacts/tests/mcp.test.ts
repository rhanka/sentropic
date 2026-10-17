/**
 * L-5e (B3) — sentropic.web-pages MCP provider (spec-v8 §9 5e): exact
 * provider ID, the 15 artifacts_* tools with closed schemas, host-bound
 * invocation scope, and dispatch over the same app as HTTP (part 1:
 * identity, manifest, read/write round-trip and refusals).
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
import {
  ARTIFACTS_TOOL_NAMES,
  WEB_PAGES_PROVIDER_ID,
  createWebPagesManifest,
  createWebPagesToolExecutor,
} from '../src/mcp.js';

const OWNER = 'owner-1';
const STRANGER = 'stranger-1';
const SCHEMA = defineParameters([{ key: 'title', type: 'string', required: true }]);
const SPEC_TOOLS = [
  'artifacts_get_template', 'artifacts_get_api_guide', 'artifacts_ensure',
  'artifacts_publish', 'artifacts_create_upload', 'artifacts_commit_upload',
  'artifacts_list', 'artifacts_get', 'artifacts_get_source', 'artifacts_fork',
  'artifacts_set_access', 'artifacts_promote', 'artifacts_renew',
  'artifacts_delete', 'artifacts_restore',
];

function makeExecutor() {
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const staging = createMemoryStaging();
  const app = createHttpArtifactApp({
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
    uploads: createUploadService(staging, { maxUploadBytes: 1024 }),
    staging,
    templates: createDefaultTemplateCatalog(),
  });
  return createWebPagesToolExecutor({ app, defaultStorageScopeId: 'scope-1' });
}

async function ensureAndPublish(executor: ReturnType<typeof makeExecutor>): Promise<string> {
  const ensured = await executor.invoke({
    tool: 'artifacts_ensure',
    actorId: OWNER,
    args: { bindingName: 'site', idempotencyKey: 'k-1', paramsHash: 'h-1', parameters: { title: 'Hi' } },
  });
  expect(ensured.status).toBe(201);
  const artifactId = (ensured.body as { artifactId: string }).artifactId;
  const files = [{ path: 'index.html', mimeType: 'text/html', bytes: [60, 104, 62] }];
  const published = await executor.invoke({
    tool: 'artifacts_publish', actorId: OWNER,
    args: { artifactId, files, idempotencyKey: 'p-1', paramsHash: 'h-1' },
  });
  expect(published.status).toBe(201);
  return artifactId;
}

describe('web-pages MCP provider', () => {
  it('exposes sentropic.web-pages with exactly the 15 spec tools', () => {
    expect(WEB_PAGES_PROVIDER_ID).toBe('sentropic.web-pages');
    expect([...ARTIFACTS_TOOL_NAMES]).toEqual(SPEC_TOOLS);
    const manifest = createWebPagesManifest();
    expect(manifest.providerId).toBe('sentropic.web-pages');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.tools.map((tool) => tool.name)).toEqual(SPEC_TOOLS);
    for (const tool of manifest.tools) {
      const schema = tool.inputSchema as { type?: unknown; additionalProperties?: unknown };
      expect(schema.type, tool.name).toBe('object');
      expect(schema.additionalProperties, tool.name).toBe(false);
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
    }
    const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));
    expect(byName.get('artifacts_delete')?.gates.requiresHumanConfirmation).toBe(true);
    expect(byName.get('artifacts_set_access')?.gates.requiresHumanConfirmation).toBe(true);
    expect(byName.get('artifacts_list')?.gates.requiresHumanConfirmation).toBe(false);
    expect(byName.get('artifacts_list')?.mutability).toBe('read-only');
    expect(byName.get('artifacts_publish')?.mutatesExternalSystem).toBe(true);
  });

  it('binds the host invocation scope only when the host supplies one', () => {
    const generic = createWebPagesManifest();
    expect(generic.tools.every((tool) => tool.requiredScopes.length === 0)).toBe(true);
    expect(generic.authz.scopes).toEqual([]);
    const bound = createWebPagesManifest({ invocationScope: 'immo:read' });
    expect(bound.tools.every((tool) => tool.requiredScopes.join() === 'immo:read')).toBe(true);
    expect(bound.authz.scopes).toEqual(['immo:read']);
  });

  it('runs ensure, publish, get, list, template and guide through the executor', async () => {
    const executor = makeExecutor();
    const artifactId = await ensureAndPublish(executor);
    const got = await executor.invoke({ tool: 'artifacts_get', actorId: OWNER, args: { artifactId } });
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ artifactId, ownerId: OWNER, state: 'active' });
    const listed = await executor.invoke({ tool: 'artifacts_list', actorId: OWNER, args: {} });
    expect(listed.body).toMatchObject({ total: 1, artifacts: [{ artifactId }] });
    const template = await executor.invoke({
      tool: 'artifacts_get_template', actorId: OWNER, args: { templateId: 'static-html' },
    });
    expect(template.status).toBe(200);
    const guide = await executor.invoke({ tool: 'artifacts_get_api_guide', actorId: OWNER, args: {} });
    expect(guide.body).toMatchObject({ version: 'v1' });
  });

  it('refuses strangers, unknown tools and malformed arguments', async () => {
    const executor = makeExecutor();
    const artifactId = await ensureAndPublish(executor);
    const stranger = await executor.invoke({
      tool: 'artifacts_get', actorId: STRANGER, args: { artifactId },
    });
    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual({ error: 'not_found' });
    await expect(
      executor.invoke({ tool: 'pages_ensure_site', actorId: OWNER, args: {} }),
    ).rejects.toThrow(/unknown artifacts tool/);
    await expect(
      executor.invoke({ tool: 'artifacts_get', actorId: OWNER, args: {} }),
    ).rejects.toThrow(/missing artifactId/);
  });
});
