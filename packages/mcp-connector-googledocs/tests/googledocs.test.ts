/**
 * BR-72 Wave-1 benchmark proof — Google Docs connector adapter contract tests.
 *
 * Asserts: manifest is read-only-only (no `mutatesExternalSystem: true`
 * anywhere); `listCapabilities` returns the declared set; every read
 * capability invoked via a mock `StpConnectorContext` returns `ok: true` +
 * fixture output + an auditId; `getSecret` is never called on read paths;
 * `validateSecrets` discloses state only (never a secret value).
 */
import { describe, expect, it, vi } from 'vitest';
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { googledocsConnectorAdapter } from '../src/adapter.js';
import { googledocsManifest } from '../src/manifest.js';

function makeCtx(getSecretSpy: ReturnType<typeof vi.fn>): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-seed',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: [
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      ],
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

const resourceNames = googledocsManifest.resources.map((r) => r.name);
const toolNames = googledocsManifest.tools.map((t) => t.name);

describe('googledocs connector adapter (BR-72 read-only benchmark proof)', () => {
  it('declares only read-only capabilities (no mutatesExternalSystem: true anywhere)', () => {
    for (const resource of googledocsManifest.resources) {
      expect(resource.mutability).toBe('read-only');
      expect(resource.mutatesExternalSystem).toBe(false);
      expect(resource.idempotency.required).toBe(false);
    }
    for (const tool of googledocsManifest.tools) {
      expect(tool.mutability).toBe('read-only');
      expect(tool.mutatesExternalSystem).toBe(false);
      expect(tool.idempotency.required).toBe(false);
      expect(tool.category).toBe('read');
    }
    expect(googledocsManifest.prompts).toHaveLength(0);
  });

  it('listCapabilities returns exactly the declared resource + tool set', async () => {
    const tenantCtx = await googledocsConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const capabilities = await googledocsConnectorAdapter.listCapabilities(tenantCtx);
    const names = capabilities.map((c) => c.name).sort();
    expect(names).toEqual([...resourceNames, ...toolNames].sort());
  });

  const resourceCases: Array<{ capabilityRef: string; uri: string }> = [
    { capabilityRef: 'get_document_metadata', uri: 'googledocs://documents/demoDocId0001/metadata' },
    { capabilityRef: 'get_document_content', uri: 'googledocs://documents/demoDocId0001' },
  ];

  for (const { capabilityRef, uri } of resourceCases) {
    it(`readResource(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await googledocsConnectorAdapter.readResource({
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

  const toolCases = [
    'get_document_plaintext',
    'export_document_as_pdf',
    'search_documents',
    'list_spreadsheet_charts',
  ];
  for (const capabilityRef of toolCases) {
    it(`invokeTool(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await googledocsConnectorAdapter.invokeTool({ capabilityRef, input: {}, ctx });
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
    const tenantCtx = await googledocsConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const statuses = await googledocsConnectorAdapter.validateSecrets(tenantCtx);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(Object.keys(status)).not.toContain('value');
      expect(['active', 'revoked', 'expired', 'suspended']).toContain(status.state);
    }
  });
});
