import { describe, expect, it, vi } from 'vitest';
import type { AppMcpProviderManifest, ConnectorTenantContext } from '../../mcp-platform/src/manifest.js';
import type { AppConnectorProviderAdapter, StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { gmailAdapter, googleDriveAdapter, mountedConnectorId } from '../src/adapter.js';
import { gmailManifest, googleDriveManifest } from '../src/manifest.js';

const syntheticSecret = 'synthetic-test-token-not-for-egress';

function makeCtx(secret: string | null = syntheticSecret): {
  ctx: StpConnectorContext;
  getSecret: ReturnType<typeof vi.fn>;
  auditEmit: ReturnType<typeof vi.fn>;
  auditEvents: unknown[];
} {
  const auditEvents: unknown[] = [];
  const getSecret = vi.fn(async () => secret);
  const auditEmit = vi.fn(async (event: unknown) => {
    auditEvents.push(event);
  });
  return {
    ctx: {
      requestId: 'req-1',
      correlationId: 'corr-1',
      auditId: 'audit-seed',
      principal: {
        sub: 'user-1',
        claims: {},
        scopes: [],
        tenantRef: 'tenant-1',
        authTime: new Date().toISOString(),
      },
      surface: 'backend',
      session: { mcpSessionId: 'session-1' },
      tenantRef: 'tenant-1',
      workspaceRef: 'workspace-1',
      connectorInstanceId: 'google-account-1',
      consentRefs: [],
      grantRefs: [],
      getSecret: getSecret as StpConnectorContext['getSecret'],
      connectorConfig: {},
      audit: { emit: auditEmit },
      logger: console,
    },
    getSecret,
    auditEmit,
    auditEvents,
  };
}

const providers: Array<{
  label: string;
  adapter: AppConnectorProviderAdapter;
  manifest: AppMcpProviderManifest;
}> = [
  { label: 'Google Drive', adapter: googleDriveAdapter, manifest: googleDriveManifest },
  { label: 'Gmail', adapter: gmailAdapter, manifest: gmailManifest },
];

describe('Google connector adapters (hermetic read-only benchmark proof)', () => {
  it('mounts distinct Google accounts through their connectorInstanceId', () => {
    expect(mountedConnectorId('googleDrive', 'account-a')).toBe('googleDrive:account-a');
    expect(mountedConnectorId('googleDrive', 'account-b')).toBe('googleDrive:account-b');
  });

  for (const { label, adapter, manifest } of providers) {
    it(`${label} declares only read-only, non-mutating capabilities`, () => {
      for (const capability of [...manifest.resources, ...manifest.tools, ...manifest.prompts]) {
        expect(capability.mutability).toBe('read-only');
        expect(capability.mutatesExternalSystem).toBe(false);
        expect(capability.idempotency.required).toBe(false);
        expect(capability.gates).toMatchObject({
          requiresElicitation: false,
          requiresHumanConfirmation: false,
          requiresPrincipalGate: false,
        });
      }
      expect(manifest.prompts).toHaveLength(0);
    });

    it(`${label} lists exactly its declared capability set and preserves tenant scope`, async () => {
      const tenantCtx = await adapter.resolveTenant({
        principalSub: 'user-1',
        tenantRef: 'tenant-1',
        workspaceRef: 'workspace-1',
        connectorInstanceId: 'google-account-1',
        selectorHints: { tenantRef: 'must-not-be-used' },
      });
      expect(tenantCtx).toEqual({
        principalRef: 'user-1',
        tenantRef: 'tenant-1',
        workspaceRef: 'workspace-1',
        connectorInstanceId: 'google-account-1',
      } satisfies ConnectorTenantContext);
      const capabilities = await adapter.listCapabilities(tenantCtx);
      expect(capabilities.map((capability) => capability.name).sort()).toEqual(
        [...manifest.resources, ...manifest.tools, ...manifest.prompts]
          .map((capability) => capability.name)
          .sort(),
      );
    });

    for (const resource of manifest.resources) {
      it(`${label} readResource(${resource.name}) returns a fixture and resolves its secret by reference`, async () => {
        const { ctx, getSecret, auditEvents } = makeCtx();
        const result = await adapter.readResource({
          capabilityRef: resource.name,
          input: { uri: resource.uriTemplate },
          ctx,
        });
        expect(result).toMatchObject({ ok: true, auditId: expect.any(String) });
        expect(result.output).toBeDefined();
        expect(result.redactionClass).toBe(resource.redactionClass);
        expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
        expect(JSON.stringify({ result, auditEvents })).not.toContain(syntheticSecret);
      });
    }

    for (const tool of manifest.tools) {
      it(`${label} invokeTool(${tool.name}) returns a fixture and resolves its secret by reference`, async () => {
        const { ctx, getSecret, auditEvents } = makeCtx();
        const result = await adapter.invokeTool({ capabilityRef: tool.name, input: {}, ctx });
        expect(typeof result).not.toBe('string');
        if (typeof result === 'string') throw new Error('read-only tool returned a durable call reference');
        expect(result).toMatchObject({ ok: true, auditId: expect.any(String) });
        expect(result.output).toBeDefined();
        expect(result.redactionClass).toBe(tool.redactionClass);
        expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
        expect(JSON.stringify({ result, auditEvents })).not.toContain(syntheticSecret);
      });
    }

    it(`${label} handles an empty fixture secret as no-auth and exposes state only`, async () => {
      const { ctx, getSecret } = makeCtx(null);
      const result = await adapter.readResource({
        capabilityRef: manifest.resources[0].name,
        input: { uri: manifest.resources[0].uriTemplate },
        ctx,
      });
      expect(result.ok).toBe(true);
      expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
      const tenantCtx = await adapter.resolveTenant({
        principalSub: 'user-1',
        tenantRef: 'tenant-1',
        connectorInstanceId: 'google-account-1',
      });
      const statuses = await adapter.validateSecrets(tenantCtx);
      expect(statuses).toEqual([
        { name: 'googleOAuthAccessToken', scope: 'principal', state: 'active' },
      ]);
      for (const status of statuses) {
        expect(Object.keys(status)).not.toContain('value');
        expect(Object.keys(status)).toEqual(expect.arrayContaining(['name', 'scope', 'state']));
      }
    });
  }
});
