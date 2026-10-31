import { createHash } from 'node:crypto';
import type { AuthUser } from '../../middleware/auth';
import { pool } from '../../db/client';
import { resolveTenantAuthoritatively } from '../tenancy/resolve-tenant';
import { compositeCatalogRegistry, prepareHostRegistryCatalog } from '../skills/catalog';
import { createCatalogContextResolver, type CatalogContextInput } from './request-context';

/** First-party HTTP sessions and verified conversation turns have separate session authorities.
 * OAuth consent is not borrowed from a first-party session. Provider grants remain provider-owned.
 * W4.a intentionally binds turns to conversation + current account/memberships, not login liveness:
 * logout or login expiry does not stop a running turn; conversation/account/membership revocation does.
 */
const resolve = createCatalogContextResolver(async input => {
  const tenant = await resolveTenantAuthoritatively({ workspaceId: input.workspaceId, userId: input.userId });
  if ('error' in tenant) throw new Error('catalog_access_denied');
  const sessionTable = input.kind === 'http' ? 'user_sessions' : 'chat_sessions';
  const sessionConstraint = input.kind === 'http' ? 's.expires_at > clock_timestamp()' : 's.workspace_id = w.id';
  // Activity touches and conversation title updates are not policy changes.
  const sessionRevision = input.kind === 'http' ? 's.expires_at::text' : 's.workspace_id';
  const result = await pool.query<{ role: string; type: string; revision: string }>(
    `SELECT wm.role, w.type, concat_ws(':', ${sessionRevision}, u.xmin, w.xmin, wm.xmin, tm.xmin, t.xmin) AS revision
     FROM ${sessionTable} s JOIN users u ON u.id = s.user_id
     JOIN workspace_memberships wm ON wm.user_id = u.id AND wm.workspace_id = $3
     JOIN workspaces w ON w.id = wm.workspace_id
     JOIN tenant_memberships tm ON tm.user_id = u.id AND tm.tenant_id = w.tenant_id
     JOIN tenants t ON t.id = w.tenant_id
     WHERE s.id = $2 AND u.id = $1 AND w.tenant_id = $4 AND ${sessionConstraint}
       AND u.account_status = 'active' AND u.disabled_at IS NULL AND w.hidden_at IS NULL
       AND tm.status = 'approved' AND t.status = 'active'`,
    [input.userId, input.sessionId, input.workspaceId, tenant.tenantId],
  );
  const row = result.rows[0];
  if (!row || !['viewer', 'commenter', 'editor', 'admin'].includes(row.role)) throw new Error('catalog_access_denied');
  const names = compositeCatalogRegistry.list().flatMap(entry =>
    entry.kind === 'skill' ? entry.skill.tools.map(tool => tool.name)
      : entry.kind === 'tool' ? [entry.metadata.name] : []);
  if (process.env.APP_ARTIFACT_HOST_ENABLED === '1') {
    // The compiled registry owns public identifiers; never sanitize or reconstruct them here.
    names.push(...(await prepareHostRegistryCatalog())!.tools.keys());
  }
  return { tenantId: tenant.tenantId, membershipRef: `${input.workspaceId}:${input.userId}:${row.role}`,
    consentRef: `first-party:${input.kind}:${input.sessionId}`,
    policyVersion: createHash('sha256').update(row.revision).digest('hex'),
    roles: [row.role], workspaceType: row.type, readOnly: !['editor', 'admin'].includes(row.role),
    allowedTools: [...new Set(['search_skills', 'search_catalog', ...names])] };
});

export const resolveHttpCatalogContext = (user: AuthUser) => resolve({ kind: 'http',
  userId: user?.userId, sessionId: user?.sessionId, workspaceId: user?.workspaceId });

export const resolveTurnCatalogContext = (turn: Omit<CatalogContextInput, 'kind'>) =>
  resolve({ ...turn, kind: 'turn' });
