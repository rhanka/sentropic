/**
 * BR-72 Wave-1 benchmark proof — Dropbox connector adapter contract tests.
 *
 * Asserts: manifest is read-only-only (no `mutatesExternalSystem: true`
 * anywhere); `listCapabilities` returns the declared set; every read
 * capability invoked via a mock `StpConnectorContext` returns `ok: true` +
 * fixture output + an auditId; `getSecret` is never called on read paths;
 * `validateSecrets` discloses state only (never a secret value).
 */
import { describe, expect, it, vi } from 'vitest';
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { dropboxConnectorAdapter } from '../src/adapter.js';
import { dropboxManifest } from '../src/manifest.js';

function makeCtx(getSecretSpy: ReturnType<typeof vi.fn>): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-seed',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: ['account_info.read', 'files.metadata.read', 'files.content.read', 'sharing.read'],
      tenantRef: 'tenant-1',
      authTime: new Date().toISOString(),
    },
    surface: 'backend',
    session: { mcpSessionId: 'session-1' },
    tenantRef: 'tenant-1',
    connectorInstanceId: 'connector-instance-1',
    consentRefs: [],
    grantRefs: [],
    getSecret: getSecretSpy,
    connectorConfig: {},
    audit: { emit: vi.fn(async () => {}) },
    logger: console,
  };
}

const resourceNames = dropboxManifest.resources.map((r) => r.name);
const toolNames = dropboxManifest.tools.map((t) => t.name);

describe('dropbox connector adapter (BR-72 read-only benchmark proof)', () => {
  it('declares only read-only capabilities (no mutatesExternalSystem: true anywhere)', () => {
    for (const resource of dropboxManifest.resources) {
      expect(resource.mutability).toBe('read-only');
      expect(resource.mutatesExternalSystem).toBe(false);
      expect(resource.idempotency.required).toBe(false);
    }
    for (const tool of dropboxManifest.tools) {
      expect(tool.mutability).toBe('read-only');
      expect(tool.mutatesExternalSystem).toBe(false);
      expect(tool.idempotency.required).toBe(false);
      expect(tool.category).toBe('read');
    }
    expect(dropboxManifest.prompts).toHaveLength(0);
  });

  it('listCapabilities returns exactly the declared resource + tool set', async () => {
    const tenantCtx = await dropboxConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const capabilities = await dropboxConnectorAdapter.listCapabilities(tenantCtx);
    const names = capabilities.map((c) => c.name).sort();
    expect(names).toEqual([...resourceNames, ...toolNames].sort());
  });

  const resourceCases: Array<{ capabilityRef: string; uri: string }> = [
    { capabilityRef: 'get_current_account', uri: 'dropbox://account' },
    {
      capabilityRef: 'get_metadata',
      uri: 'dropbox://files/Demo%20Folder/README.md',
    },
    {
      capabilityRef: 'download_file',
      uri: 'dropbox://files/Demo%20Folder/README.md/content',
    },
    {
      capabilityRef: 'get_shared_link_metadata',
      uri: 'dropbox://shared-links/https%3A%2F%2Fwww.dropbox.com%2Fs%2Fdemo-share-link%2FREADME.md%3Fdl%3D0',
    },
  ];

  for (const { capabilityRef, uri } of resourceCases) {
    it(`readResource(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await dropboxConnectorAdapter.readResource({
        capabilityRef,
        input: { uri },
        ctx,
      });
      expect(result.ok).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.auditId).toBeTruthy();
      expect(getSecretSpy).not.toHaveBeenCalled();
    });
  }

  const toolCases = ['list_folder', 'search_files', 'list_shared_links', 'list_revisions'];
  for (const capabilityRef of toolCases) {
    it(`invokeTool(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await dropboxConnectorAdapter.invokeTool({ capabilityRef, input: {}, ctx });
      if (typeof result === 'string') {
        throw new Error(`unexpected DurableCallRef for read-only tool ${capabilityRef}`);
      }
      expect(result.ok).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.auditId).toBeTruthy();
      expect(getSecretSpy).not.toHaveBeenCalled();
    });
  }

  it('validateSecrets discloses state only (never a secret value)', async () => {
    const tenantCtx = await dropboxConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const statuses = await dropboxConnectorAdapter.validateSecrets(tenantCtx);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(Object.keys(status)).not.toContain('value');
      expect(['active', 'revoked', 'expired', 'suspended']).toContain(status.state);
    }
  });
});
