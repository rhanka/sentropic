import { ARTIFACTS_TOOL_SPECS } from '@sentropic/artifacts/mcp-core';

/**
 * Static claude.ai MCP connector client (public, PKCE, refresh). It replaces the retired
 * hosted h2a MCP role and is read-only: DEC-116 parity. `mcp:tools:invoke` alone cannot
 * express "read-only", so the restriction is a per-client tool allowlist enforced by the
 * resource server, never by the client.
 */
export const SENTROPIC_MCP_CLIENT_ID = 'sentropic-mcp';

/** Clients bound to the read-only allowlist. Every other client keeps the full surface. */
export const READ_ONLY_CLIENT_IDS: ReadonlySet<string> = new Set([SENTROPIC_MCP_CLIENT_ID]);

/**
 * Explicit allowlist (a new read-only tool is NOT exposed until added here). The test
 * suite pins every entry to a `read-only` artifact tool definition.
 */
export const READ_ONLY_TOOL_ALLOWLIST: readonly string[] = Object.freeze([
  'artifacts_list', 'artifacts_get', 'artifacts_list_app_sources', 'artifacts_fetch_app_source',
  'artifacts_live_read', 'artifacts_live_status', 'artifacts_get_template', 'artifacts_get_api_guide',
  'artifacts_get_source', 'artifacts_list_versions', 'artifacts_lookup_people', 'artifacts_list_access',
  'artifacts_list_assets',
]);

/** Connector capabilities (gmail/drive) a read-only client may call: the P1 get/list set. */
export const READ_ONLY_CONNECTOR_CAPABILITIES: readonly string[] = Object.freeze([
  'messages.get', 'threads.get', 'messages.list', 'labels.list',
  'about.get', 'files.get', 'files.list', 'files.export', 'permissions.list',
]);

export const isReadOnlyClient = (clientId: string): boolean => READ_ONLY_CLIENT_IDS.has(clientId);

export const isToolPermitted = (clientId: string, tool: string): boolean =>
  !isReadOnlyClient(clientId) || READ_ONLY_TOOL_ALLOWLIST.includes(tool);

export const isConnectorCapabilityPermitted = (clientId: string, capability: string): boolean =>
  !isReadOnlyClient(clientId) || READ_ONLY_CONNECTOR_CAPABILITIES.includes(capability);

/** Allowlist members whose definition is not read-only (must be empty; used by the tests). */
export const nonReadOnlyAllowlistEntries = (): string[] => {
  const mutability = new Map<string, string>(ARTIFACTS_TOOL_SPECS.map(spec => [spec.name, spec.mutability]));
  return READ_ONLY_TOOL_ALLOWLIST.filter(tool => mutability.get(tool) !== 'read-only');
};

export interface WorkspaceMembershipPorts {
  defaultWorkspaceId(sub: string): Promise<string | null | undefined>;
  role(sub: string, workspaceId: string): Promise<string | null>;
}

/**
 * Server-side workspace resolution: the requested (or default) workspace is honoured only
 * when the verified subject is a member. Never trusts a caller-supplied workspace id.
 */
export async function resolveMemberWorkspace(
  sub: string,
  requested: string | undefined,
  ports: WorkspaceMembershipPorts,
): Promise<{ ok: true; workspaceId: string } | { ok: false }> {
  const workspaceId = requested?.trim() || await ports.defaultWorkspaceId(sub) || '';
  if (!workspaceId) return { ok: false };
  return (await ports.role(sub, workspaceId)) ? { ok: true, workspaceId } : { ok: false };
}

export type ConnectorAdmissionDecision =
  | { allowed: true }
  | { allowed: false; reason: string; status: 403 | 409 | 503 };

export interface ConnectorAdmissionInput {
  operation: 'invoke' | 'read';
  request: {
    capabilityRef: string;
    workspaceRef?: string;
    principal: { sub: string; clientId: string; tid: string | null };
  };
}

/**
 * Connector admission shared by gmail/drive invoke and read: tid required (A4), per-client
 * read-only capability allowlist, server-side workspace membership, then the cluster-mesh
 * author/supervisor admission supplied by the host.
 */
export const createConnectorAdmission = (
  membership: WorkspaceMembershipPorts,
  admit: () => Promise<ConnectorAdmissionDecision>,
) => async (input: ConnectorAdmissionInput): Promise<ConnectorAdmissionDecision> => {
  const { principal, capabilityRef, workspaceRef } = input.request;
  if (!principal.sub || !principal.tid) return { allowed: false, reason: 'access_denied', status: 403 };
  if (input.operation === 'invoke' && !isConnectorCapabilityPermitted(principal.clientId, capabilityRef)) {
    return { allowed: false, reason: 'tool_not_permitted', status: 403 };
  }
  const member = await resolveMemberWorkspace(principal.sub, workspaceRef, membership);
  if (!member.ok) return { allowed: false, reason: 'workspace_forbidden', status: 403 };
  return admit();
};
