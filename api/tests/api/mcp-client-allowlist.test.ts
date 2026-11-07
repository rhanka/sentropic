import { describe, expect, it, vi } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';

import { createArtifactTransport } from '../../src/services/artifacts/transport';
import { READ_ONLY_TOOL_ALLOWLIST, SENTROPIC_MCP_CLIENT_ID } from '../../src/services/mcp/client-policy';

const identity = (clientId: string) =>
  ({ subject: 'alice', tenantId: 'tenant-a', clientId, credentialId: 'token-a' });
const scopes = ['mcp:discover', 'mcp:tools:invoke'];

function fixture() {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const mcp = vi.fn(async () => ({ status: 200, body: { ok: true } }));
  const bind = vi.fn(async () => ({ profile, http: vi.fn(), mcp }));
  return { transport: createArtifactTransport({ profile, bind } as never), mcp };
}

describe('artifact transport: read-only allowlist for the sentropic-mcp client', () => {
  it('lists only allowlisted tools to the restricted client and the full surface to others', async () => {
    const { transport } = fixture();
    const full = (await transport.discover(identity('immo-mcp'), 'ws', scopes)).map(t => t.name);
    const restricted = (await transport.discover(identity(SENTROPIC_MCP_CLIENT_ID), 'ws', scopes)).map(t => t.name);
    expect(full).toContain('artifacts_ensure');
    expect(restricted).not.toContain('artifacts_ensure');
    expect(restricted.every(name => READ_ONLY_TOOL_ALLOWLIST.includes(name))).toBe(true);
    expect(restricted.length).toBeLessThan(full.length);
  });

  it('refuses a write tool call from the restricted client without binding or executing it', async () => {
    const { transport, mcp } = fixture();
    const result = await transport.invoke(identity(SENTROPIC_MCP_CLIENT_ID), 'ws', scopes, 'artifacts_ensure',
      { bindingName: 'report', idempotencyKey: 'key' });
    expect(result.status).toBe(403);
    expect(mcp).not.toHaveBeenCalled();
  });

  it('still lets another client call the same write tool', async () => {
    const { transport, mcp } = fixture();
    const result = await transport.invoke(identity('immo-mcp'), 'ws', scopes, 'artifacts_ensure',
      { bindingName: 'report', idempotencyKey: 'key' });
    expect(result.status).toBe(200);
    expect(mcp).toHaveBeenCalledTimes(1);
  });
});
