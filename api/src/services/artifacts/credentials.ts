import { MCP_SCOPES } from '@sentropic/mcp-auth';
import type { CurrentArtifactIdentity } from './authorization';

const denied = { readable: false, writable: false } as const;
export const ARTIFACT_SESSION_CLIENT = 'sentropic-session';

/** Called on the coordinator's leased transaction, including after every wait. */
export function createArtifactCredentialReader(options: {
  kind: 'session' | 'oauth'; resource: string; jkt: string | null;
  requiredScopes?: readonly string[];
}): CurrentArtifactIdentity {
  return async (client, identity) => {
    if (options.kind === 'session') {
      if (identity.clientId !== ARTIFACT_SESSION_CLIENT) return denied;
      const query = `SELECT session_id FROM cm_identity.identity_login_sessions
        WHERE session_id = $1 AND user_id = $2 AND status = 'active' AND revoked_at IS NULL
          AND expires_at::timestamptz > clock_timestamp()`;
      const result = await client.query(`${query} FOR SHARE`,
      [identity.credentialId, identity.subject]);
      if (result.rowCount !== 1) return denied;
      const active = await client.query(query, [identity.credentialId, identity.subject]);
      return { readable: active.rowCount === 1, writable: active.rowCount === 1 };
    }
    const result = await client.query<{ scope: string; allowed: string[]; consent: string[] }>(
      `SELECT t.scope, c.allowed_scopes AS allowed, g.scopes AS consent
       FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
       JOIN oauth_consents g ON g.client_id = t.client_id AND g.user_id = t.user_id AND g.tenant_id = t.tenant_id
       WHERE t.jti = $1 AND t.user_id = $2 AND t.client_id = $3 AND t.tenant_id = $4
         AND t.token_type = 'access_token' AND t.audience = $5
         AND t.dpop_jkt IS NOT DISTINCT FROM $6::text
         AND (NOT c.dpop_bound_access_tokens OR t.dpop_jkt IS NOT NULL)
         AND t.expires_at > clock_timestamp() FOR SHARE OF t, c, g`,
      [identity.credentialId, identity.subject, identity.clientId, identity.tenantId, options.resource, options.jkt]);
    const row = result.rows[0];
    if (!row) return denied;
    // A separate statement sees revocations committed during the preceding row-lock wait.
    const active = await client.query(`SELECT jti FROM oauth_tokens t WHERE t.jti = $1
      AND t.expires_at > clock_timestamp() AND NOT EXISTS
        (SELECT 1 FROM revoked_tokens r WHERE r.jti = t.jti AND r.expires_at > clock_timestamp())`,
    [identity.credentialId]);
    if (active.rowCount !== 1) return denied;
    const scopes = row.scope.split(/\s+/).filter(scope => row.allowed.includes(scope) && row.consent.includes(scope));
    if (options.requiredScopes?.some(scope => !scopes.includes(scope))) return denied;
    return { readable: [MCP_SCOPES.DISCOVER, MCP_SCOPES.RESOURCES_READ, MCP_SCOPES.TOOLS_INVOKE].some(scope => scopes.includes(scope)),
      writable: scopes.includes(MCP_SCOPES.TOOLS_INVOKE) };
  };
}

/** Host-only encoding keeps credential kind/proof binding out of public command arguments. */
export function artifactCredential(kind: 'session' | 'oauth', id: string, jkt: string | null = null,
  requiredScopes: readonly string[] = []): string {
  if (!id) throw new Error('Artifact credential ID required');
  return JSON.stringify([kind, id, jkt, requiredScopes]);
}

/** A conversation is bound to its workspace; it is never accepted as a login session. */
export function artifactTurnCredential(sessionId: string, workspaceId: string): string {
  if (!sessionId || !workspaceId) throw new Error('Artifact turn binding required');
  return JSON.stringify(['turn', sessionId, workspaceId, []]);
}

export function createCurrentArtifactIdentity(resource: string): CurrentArtifactIdentity {
  return async (client, identity) => {
    let parts: unknown;
    try { parts = JSON.parse(identity.credentialId); } catch { return denied; }
    if (Array.isArray(parts) && parts.length === 4 && parts[0] === 'turn') {
      if (identity.clientId !== 'sentropic-turn' || typeof parts[1] !== 'string' || !parts[1] ||
        typeof parts[2] !== 'string' || !parts[2] || !Array.isArray(parts[3]) || parts[3].length) return denied;
      const params = [parts[1], identity.subject, parts[2]];
      const query = `SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2 AND workspace_id = $3`;
      const locked = await client.query(`${query} FOR SHARE`, params);
      if (locked.rowCount !== 1) return denied;
      // A fresh statement observes a deletion or workspace change committed during a lock wait.
      const active = await client.query(query, params);
      return { readable: active.rowCount === 1, writable: active.rowCount === 1 };
    }
    if (!Array.isArray(parts) || parts.length !== 4 || !['session', 'oauth'].includes(parts[0]) ||
      typeof parts[1] !== 'string' || !parts[1] || (parts[2] !== null && typeof parts[2] !== 'string') ||
      !Array.isArray(parts[3]) || parts[3].some(scope => typeof scope !== 'string' || !scope)) return denied;
    return createArtifactCredentialReader({ kind: parts[0], resource, jkt: parts[2], requiredScopes: parts[3] })(client,
      { ...identity, credentialId: parts[1] });
  };
}
