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
import { createTransportWorld } from './fixtures/transport-world.js';

it('should publish accented UTF-8 text through MCP and reject ambiguous or binary text', async () => {
  const world = createTransportWorld();
  const ensured = await world.http('/ensure', { bindingName: 'site', idempotencyKey: 'utf8-ensure' });
  if (!ensured.ok) throw new Error('ensure failed');
  const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
  const text = '<h1>Été à Montréal 🏠</h1>';
  const file = { path: 'index.html', mimeType: 'text/html', text };
  let attempt = 0;
  const publish = (files: unknown[]) => world.mcp.invoke({ tool: 'artifacts_publish',
    invocation: world.invocation(), args: { artifactId, files, idempotencyKey: `utf8-${attempt++}` } });
  expect((await publish([file])).status).toBe(201);
  const [blobKey] = await world.blobs.listKeys('artifacts/scope-l6/blobs/');
  expect(new TextDecoder().decode(await world.blobs.getBlob(blobKey))).toBe(text);
  expect((await publish([{ ...file, bytes: [65] }])).status).toBe(400);
  expect((await publish([{ ...file, mimeType: 'image/png' }])).status).toBe(400);
  expect(world.releases.size).toBe(1);
});

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
  it('should require a compiled profile rather than implicitly selecting all tools', () => {
    expect(() => createArtifactsManifest()).toThrow();
  });
  it('should reject direct unselected dispatch before calling the app', async () => {
    let calls = 0;
    const app = { profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities,
      execute: async () => { calls += 1; throw new Error('unexpected app call'); } };
    const executor = createArtifactsToolExecutor({ app, profile });
    const outcome = await executor.execute({ tool: 'artifacts_delete', args: { artifactId: 'x' },
      invocation: { invocationId: 'mcp-1', actorId: 'alice', storageScopeId: 'scope-1',
        authorizeCommit: async () => { throw new Error('unexpected guard'); } } });
    expect(outcome).toMatchObject({ ok: false, failure: { category: 'capability_unselected', retriable: false } });
    expect(calls).toBe(0);
  });
});

it('should align registry handlers and configured bindings with the selected manifest', () => {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const definition = createArtifactsRegistryDefinition({ profile,
    app: { profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities,
      execute: async () => { throw new Error('unexpected dispatch'); } },
    createInvocation: () => { throw new Error('unexpected binding'); },
  });
  expect(Object.keys(definition.toolValues).sort()).toEqual([...profile.selectedCapabilities].sort());
  expect(Object.values(definition.handlers).map((handler) => handler.capabilityRef).sort())
    .toEqual([...profile.selectedCapabilities].sort());
});

it.each([
  { capabilityRef: 'artifacts_delete', input: {}, code: 'capability_unavailable' },
  { capabilityRef: 'artifacts_ensure', input: { bindingName: 'x' }, code: 'invalid_request' },
  { capabilityRef: 'artifacts_ensure', input: { bindingName: 'x', idempotencyKey: 'a' }, idempotencyKey: 'b', code: 'invalid_request' },
])('should refuse %j without binding or dispatching a host invocation', async ({ code, ...input }) => {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const adapter = createArtifactsAdapter({ profile,
    app: { profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities,
      execute: async () => { throw new Error('unexpected dispatch'); } },
    createInvocation: () => { throw new Error('unexpected binding'); },
  });
  const ctx = { requestId: 'request-1', auditId: 'audit-1', principal: { sub: 'alice' } } as StpConnectorContext;
  expect(await adapter.invokeTool({ ...input, ctx })).toMatchObject({ ok: false,
    error: { code, retriable: false } });
});
