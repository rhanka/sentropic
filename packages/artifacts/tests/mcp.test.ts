/**
 * L-5e (B3) — sentropic.artifacts MCP provider (spec-v8 §9 5e): exact
 * provider ID, the 15 artifacts_* tools with closed schemas, host-bound
 * invocation scope, and dispatch over the same app as HTTP (part 1:
 * identity, manifest, read/write round-trip and refusals).
 */
import { createHash } from 'node:crypto';
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
  ARTIFACTS_PROVIDER_ID,
  createArtifactsAdapter,
  createArtifactsManifest,
  createArtifactsRegistryDefinition,
  createArtifactsToolExecutor,
} from '../src/mcp.js';
import type { StpConnectorContext } from '@sentropic/mcp-platform';
import { createProviderRegistry } from '@sentropic/mcp-platform/registry';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
  });

  it('binds the host invocation scope only when the host supplies one', () => {
    const generic = createArtifactsManifest();
    expect(generic.tools.every((tool) => tool.requiredScopes.length === 0)).toBe(true);
    expect(generic.authz.scopes).toEqual([]);
    const bound = createArtifactsManifest({ invocationScope: 'immo:read' });
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

  it('runs share, fork, promote, renew, delete and restore through tools', async () => {
    const executor = makeExecutor();
    const id = await ensureAndPublish(executor);
    const granted = await executor.invoke({
      tool: 'artifacts_set_access', actorId: OWNER,
      args: { artifactId: id, action: 'grant', principalId: READER, grant: 'read' },
    });
    expect(granted.status).toBe(200);
    const readerGet = await executor.invoke({ tool: 'artifacts_get', actorId: READER, args: { artifactId: id } });
    expect(readerGet.status).toBe(200);
    const readerSource = await executor.invoke({
      tool: 'artifacts_get_source', actorId: READER, args: { artifactId: id },
    });
    expect(readerSource.status).toBe(403);
    const forked = await executor.invoke({ tool: 'artifacts_fork', actorId: READER, args: { artifactId: id } });
    expect(forked.status).toBe(201);
    expect((forked.body as { artifactId: string }).artifactId).not.toBe(id);
    const v2 = await executor.invoke({
      tool: 'artifacts_publish', actorId: OWNER,
      args: {
        artifactId: id,
        files: [{ path: 'index.html', mimeType: 'text/html', bytes: [60, 50, 62] }],
        idempotencyKey: 'p-2', paramsHash: 'h-2',
      },
    });
    const v2Id = (v2.body as { releaseId: string }).releaseId;
    const meta = await executor.invoke({ tool: 'artifacts_get', actorId: OWNER, args: { artifactId: id } });
    const current = (meta.body as { currentReleaseId: string }).currentReleaseId;
    expect(current).toBe(v2Id);
    const stale = await executor.invoke({
      tool: 'artifacts_promote', actorId: OWNER,
      args: { artifactId: id, releaseId: v2Id, expectedCurrent: 'not-current' },
    });
    expect(stale.status).toBe(409);
    const renewed = await executor.invoke({ tool: 'artifacts_renew', actorId: OWNER, args: { artifactId: id } });
    expect(renewed.status).toBe(200);
    const deleted = await executor.invoke({ tool: 'artifacts_delete', actorId: OWNER, args: { artifactId: id } });
    expect(deleted.body).toMatchObject({ state: 'deleted' });
    const restored = await executor.invoke({
      tool: 'artifacts_restore', actorId: OWNER, args: { artifactId: id },
    });
    expect(restored.body).toMatchObject({ state: 'active' });
    await expect(
      executor.invoke({
        tool: 'artifacts_set_access', actorId: OWNER,
        args: { artifactId: id, action: 'bogus' },
      }),
    ).rejects.toThrow(/unknown set-access action/);
  });

  it('commits a bounded upload session through tools', async () => {
    const executor = makeExecutor();
    const id = await ensureAndPublish(executor);
    const begun = await executor.invoke({
      tool: 'artifacts_create_upload', actorId: OWNER,
      args: { artifactId: id, mimeType: 'text/plain' },
    });
    expect(begun.status).toBe(201);
    const uploadId = (begun.body as { uploadId: string }).uploadId;
    const committed = await executor.invoke({
      tool: 'artifacts_commit_upload', actorId: OWNER,
      args: {
        artifactId: id, uploadId, path: 'empty.txt', mimeType: 'text/plain',
        digest: EMPTY_DIGEST, size: 0, idempotencyKey: 'u-1', paramsHash: 'h-1',
      },
    });
    expect(committed.status).toBe(201);
    const strangerUpload = await executor.invoke({
      tool: 'artifacts_create_upload', actorId: STRANGER,
      args: { artifactId: id, mimeType: 'text/plain' },
    });
    expect(strangerUpload.status).toBe(404);
  });

  it('registers and compiles through the platform kernel (section 3)', () => {
    const definition = createArtifactsRegistryDefinition({ app: makeApp() });
    const registry = createProviderRegistry();
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow(/duplicate provider/);
    registry.select(['sentropic.artifacts']);
    registry.configure('sentropic.artifacts', { defaultStorageScopeId: 'scope-1' });
    const missing = registry.compile({ bindings: {}, compatibility: {} });
    expect(missing.ok).toBe(false);
    const compiled = registry.compile({
      bindings: {},
      compatibility: {
        'sentropic.artifacts': { manifestDigest: computeManifestDigest(definition.manifest) },
      },
    });
    if (!compiled.ok) throw new Error(`compile refused: ${JSON.stringify(compiled.diagnostics)}`);
    for (const name of SPEC_TOOLS) {
      expect(compiled.registry.resolveTool(name)?.providerId, name).toBe(ARTIFACTS_PROVIDER_ID);
    }
    expect(compiled.registry.resolveTool('pages_ensure_site')).toBeUndefined();
    const catalog = registry.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ providerId: ARTIFACTS_PROVIDER_ID, availability: 'available' });
  });

  it('refuses the previous provider ID as unknown for selection and configuration', () => {
    const registry = createProviderRegistry();
    registry.register(createArtifactsRegistryDefinition({ app: makeApp() }));
    expect(() => registry.select(['sentropic.web-pages'])).toThrow(/unknown provider/);
    expect(() => registry.configure('sentropic.web-pages', {})).toThrow(/unknown provider/);
  });

  it('invokes through the platform adapter with verified-principal identity', async () => {
    const adapter = createArtifactsAdapter({ app: makeApp(), defaultStorageScopeId: 'scope-1' });
    expect(adapter.connectorId).toBe(ARTIFACTS_PROVIDER_ID);
    const tenant = await adapter.resolveTenant({
      principalSub: OWNER, tenantRef: 'tenant-1', connectorInstanceId: 'inst-1',
      selectorHints: { tenantRef: 'forged' },
    });
    expect(tenant.tenantRef).toBe('tenant-1');
    expect(await adapter.validateSecrets(tenant)).toEqual([]);
    expect(await adapter.listCapabilities(tenant)).toHaveLength(15);
    const ensured = await adapter.invokeTool({
      capabilityRef: 'artifacts_ensure',
      input: { bindingName: 'site', idempotencyKey: 'k-1', paramsHash: 'h-1', parameters: { title: 'Hi' } },
      ctx: fakeCtx(OWNER),
      idempotencyKey: 'k-1',
    });
    if (typeof ensured === 'string' || !ensured.ok) throw new Error('ensure must succeed inline');
    const artifactId = (ensured.output as { artifactId: string }).artifactId;
    const stranger = await adapter.invokeTool({
      capabilityRef: 'artifacts_get', input: { artifactId }, ctx: fakeCtx(STRANGER),
    });
    if (typeof stranger === 'string') throw new Error('stranger read must not defer');
    expect(stranger.ok).toBe(false);
    expect(stranger.error?.code).toBe('not_found');
    const unknown = await adapter.invokeTool({
      capabilityRef: 'pages_ensure_site', input: {}, ctx: fakeCtx(OWNER),
    });
    if (typeof unknown === 'string') throw new Error('unknown tool must not defer');
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('invalid_request');
    expect(unknown.error?.message).toBe('invalid_request');
  });
});
