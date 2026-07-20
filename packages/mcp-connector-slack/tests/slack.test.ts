/**
 * BR-72 Wave-1 benchmark proof — Slack connector adapter contract tests.
 *
 * Asserts: manifest is read-only-only (no `mutatesExternalSystem: true`
 * anywhere); `listCapabilities` returns the declared set; every read
 * capability invoked via a mock `StpConnectorContext` returns `ok: true` +
 * fixture output + an auditId; `getSecret` is never called on read paths;
 * `validateSecrets` discloses state only (never a secret value).
 */
import { describe, expect, it, vi } from 'vitest';
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { slackConnectorAdapter } from '../src/adapter.js';
import { slackManifest } from '../src/manifest.js';

function makeCtx(getSecretSpy: ReturnType<typeof vi.fn>): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-seed',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read', 'users:read', 'files:read'],
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

const resourceNames = slackManifest.resources.map((r) => r.name);
const toolNames = slackManifest.tools.map((t) => t.name);

describe('slack connector adapter (BR-72 read-only benchmark proof)', () => {
  it('declares only read-only capabilities (no mutatesExternalSystem: true anywhere)', () => {
    for (const resource of slackManifest.resources) {
      expect(resource.mutability).toBe('read-only');
      expect(resource.mutatesExternalSystem).toBe(false);
      expect(resource.idempotency.required).toBe(false);
    }
    for (const tool of slackManifest.tools) {
      expect(tool.mutability).toBe('read-only');
      expect(tool.mutatesExternalSystem).toBe(false);
      expect(tool.idempotency.required).toBe(false);
      expect(tool.category).toBe('read');
    }
    expect(slackManifest.prompts).toHaveLength(0);
  });

  it('listCapabilities returns exactly the declared resource + tool set', async () => {
    const tenantCtx = await slackConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const capabilities = await slackConnectorAdapter.listCapabilities(tenantCtx);
    const names = capabilities.map((c) => c.name).sort();
    expect(names).toEqual([...resourceNames, ...toolNames].sort());
  });

  const resourceCases: Array<{ capabilityRef: string; uri: string }> = [
    { capabilityRef: 'get_conversation', uri: 'slack://conversations/C0SENTROPIC1' },
    { capabilityRef: 'get_user', uri: 'slack://users/U0SENTROPIC1' },
    { capabilityRef: 'get_file', uri: 'slack://files/F0SENTROPIC1' },
  ];

  for (const { capabilityRef, uri } of resourceCases) {
    it(`readResource(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await slackConnectorAdapter.readResource({
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

  const toolCases = ['list_channels', 'list_conversations', 'list_users', 'get_channel_messages', 'get_thread'];
  for (const capabilityRef of toolCases) {
    it(`invokeTool(${capabilityRef}) returns ok:true + fixture output + auditId, never touches getSecret`, async () => {
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await slackConnectorAdapter.invokeTool({ capabilityRef, input: {}, ctx });
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
    const tenantCtx = await slackConnectorAdapter.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-1',
      connectorInstanceId: 'connector-instance-1',
    });
    const statuses = await slackConnectorAdapter.validateSecrets(tenantCtx);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(Object.keys(status)).not.toContain('value');
      expect(['active', 'revoked', 'expired', 'suspended']).toContain(status.state);
    }
  });
});
