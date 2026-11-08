import { describe, expect, it, vi } from 'vitest';

import {
  H2A_CLI_CLIENT_ID,
  READ_ONLY_CONNECTOR_CAPABILITIES,
  READ_ONLY_TOOL_ALLOWLIST,
  SENTROPIC_MCP_CLIENT_ID,
  createConnectorAdmission,
  isConnectorCapabilityPermitted,
  isReadOnlyClient,
  isToolPermitted,
  nonReadOnlyAllowlistEntries,
  resolveMemberWorkspace,
  type WorkspaceMembershipPorts,
} from '../../src/services/mcp/client-policy';

const membership = (roles: Record<string, string>, fallback: string | null = 'ws-default'): WorkspaceMembershipPorts => ({
  defaultWorkspaceId: async () => fallback,
  role: async (_sub, workspaceId) => roles[workspaceId] ?? null,
});

describe('read-only allowlist per client (DEC-116 parity)', () => {
  it('only lists tools whose definition is read-only', () => {
    expect(nonReadOnlyAllowlistEntries()).toEqual([]);
    expect(READ_ONLY_TOOL_ALLOWLIST).not.toContain('artifacts_ensure');
    expect(READ_ONLY_TOOL_ALLOWLIST).not.toContain('artifacts_publish');
  });

  it('restricts sentropic-mcp to the allowlist and leaves other clients untouched', () => {
    expect(isToolPermitted(SENTROPIC_MCP_CLIENT_ID, 'artifacts_list')).toBe(true);
    for (const tool of ['artifacts_ensure', 'artifacts_publish', 'artifacts_git_commit', 'unknown_tool']) {
      expect(isToolPermitted(SENTROPIC_MCP_CLIENT_ID, tool)).toBe(false);
      expect(isToolPermitted('immo-mcp', tool)).toBe(true);
    }
  });

  it('keeps the full write surface for the owner-delegated h2a CLI', () => {
    expect(isReadOnlyClient(H2A_CLI_CLIENT_ID)).toBe(false);
    for (const tool of ['artifacts_ensure', 'artifacts_publish', 'artifacts_get']) {
      expect(isToolPermitted(H2A_CLI_CLIENT_ID, tool)).toBe(true);
    }
  });

  it('restricts connector capabilities to the get/list set', () => {
    expect(READ_ONLY_CONNECTOR_CAPABILITIES.every(c => /\.(get|list|export)$/.test(c))).toBe(true);
    expect(isConnectorCapabilityPermitted(SENTROPIC_MCP_CLIENT_ID, 'messages.get')).toBe(true);
    expect(isConnectorCapabilityPermitted(SENTROPIC_MCP_CLIENT_ID, 'messages.send')).toBe(false);
    expect(isConnectorCapabilityPermitted('other', 'messages.send')).toBe(true);
  });
});

describe('server-side workspace membership', () => {
  it('accepts a requested workspace only for a member', async () => {
    const ports = membership({ 'ws-a': 'viewer' });
    expect(await resolveMemberWorkspace('u', 'ws-a', ports)).toEqual({ ok: true, workspaceId: 'ws-a' });
    expect(await resolveMemberWorkspace('u', 'ws-other', ports)).toEqual({ ok: false });
  });

  it('checks the default workspace too and refuses when there is none', async () => {
    expect(await resolveMemberWorkspace('u', undefined, membership({ 'ws-default': 'editor' })))
      .toEqual({ ok: true, workspaceId: 'ws-default' });
    expect(await resolveMemberWorkspace('u', undefined, membership({}))).toEqual({ ok: false });
    expect(await resolveMemberWorkspace('u', '  ', membership({}, null))).toEqual({ ok: false });
  });
});

describe('connector admission', () => {
  const principal = (over: Record<string, unknown> = {}) =>
    ({ sub: 'u', clientId: SENTROPIC_MCP_CLIENT_ID, tid: 'tenant-a', ...over });
  const admission = (roles: Record<string, string> = { 'ws-default': 'viewer' }) => {
    const admit = vi.fn(async () => ({ allowed: true as const }));
    return { admit, run: createConnectorAdmission(membership(roles), admit) };
  };

  it('admits a read capability for a tenant member and reaches the cluster-mesh admission', async () => {
    const { run, admit } = admission();
    expect(await run({ operation: 'invoke', request: { capabilityRef: 'messages.get', principal: principal() } }))
      .toEqual({ allowed: true });
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing tid, a write capability and a non-member workspace before admission', async () => {
    const { run, admit } = admission();
    expect(await run({ operation: 'invoke', request: { capabilityRef: 'messages.get', principal: principal({ tid: null }) } }))
      .toMatchObject({ allowed: false, reason: 'access_denied', status: 403 });
    expect(await run({ operation: 'invoke', request: { capabilityRef: 'messages.send', principal: principal() } }))
      .toMatchObject({ allowed: false, reason: 'tool_not_permitted', status: 403 });
    expect(await run({ operation: 'invoke', request: { capabilityRef: 'messages.get', workspaceRef: 'ws-x', principal: principal() } }))
      .toMatchObject({ allowed: false, reason: 'workspace_forbidden', status: 403 });
    expect(admit).not.toHaveBeenCalled();
  });
});
