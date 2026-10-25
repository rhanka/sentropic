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
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';

describe('L6 compiled MCP profile', () => {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  it('should expose exactly the selected closed schemas and required write keys', () => {
    const manifest = createArtifactsManifest({ profile, invocationScope: 'immo:read' });
    expect(manifest.tools.map((tool) => tool.name)).toEqual(profile.selectedCapabilities);
    expect(manifest.tools.every((tool) => tool.requiredScopes.includes('immo:read'))).toBe(true);
    for (const tool of manifest.tools) expect(tool.inputSchema).toEqual(profile.schemas[tool.name]);
    expect(manifest.tools.find((tool) => tool.name === 'artifacts_publish')?.idempotency)
      .toEqual({ required: true, scope: 'principal' });
  });
  it('should invalidate manifest integrity on a semantic-only profile change', () => {
    const other = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
      contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions, authorization: 'artifacts-authorization/v2' } });
    expect(profile.schemas).toEqual(other.schemas);
    expect(computeManifestDigest(createArtifactsManifest({ profile })))
      .not.toBe(computeManifestDigest(createArtifactsManifest({ profile: other })));
  });
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
