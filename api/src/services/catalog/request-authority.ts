import { createHash } from 'node:crypto';
import type { AuthUser } from '../../middleware/auth';
import { getCmIdentity, setCmDecisionToolCatalog } from '../identity/cm-identity';
import { runCmIdentityRead } from '../identity/cm-transaction';
import { findCmApprovedMembership } from '../identity/cm-tenancy';
import { compositeCatalogRegistry, prepareHostRegistryCatalog } from '../skills/catalog';
import { createCatalogContextResolver, type CatalogContextInput } from './request-context';

/** F15: the fresh per-request decision producer (A2.3) is the ONLY authority for
 * catalog/tool access. The legacy SQL join over `user_sessions`/`users`/
 * `workspace_memberships`/`tenant_memberships`/`tenants` is gone — those tables
 * are dropped by control migration 0014; every input is read from the CM stores.
 *
 * A refusal yields an EMPTY tool set (never a partial catalogue): the producer
 * owns that rule, and this module denies the context outright on refusal.
 * W4.a intentionally binds turns to conversation + current account/memberships, not
 * login liveness: logout or login expiry does not stop a running turn;
 * conversation/account/membership revocation does.
 */

const baseToolNames = (): string[] => {
  const names = compositeCatalogRegistry.list().flatMap(entry =>
    entry.kind === 'skill' ? entry.skill.tools.map(tool => tool.name)
      : entry.kind === 'tool' ? [entry.metadata.name] : []);
  return [...new Set(['search_skills', 'search_catalog', ...names])];
};

// Installed once at module load: the F15 producer maps an allowed decision to the
// allowed tool set through this catalog.
setCmDecisionToolCatalog({ toolsForDecision: () => baseToolNames() });

const resolve = createCatalogContextResolver(input => runCmIdentityRead(async tx => {
  const { decision: producer } = getCmIdentity();
  const now = new Date().toISOString();
  let conversationSessionId: string | undefined;
  if (input.kind === 'turn') {
    const result = await tx.hostTransaction.query<{ cm_conversation_session_id: string | null }>(
      `SELECT cm_conversation_session_id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 AND workspace_id = $3`,
      [input.sessionId, input.userId, input.workspaceId]);
    conversationSessionId = result.rows[0]?.cm_conversation_session_id ?? undefined;
    if (!conversationSessionId) throw new Error('catalog_access_denied');
  }
  const fresh = await producer.decide(
    input.kind === 'http'
      ? { inputKind: 'first_party_http', userId: input.userId, workspaceId: input.workspaceId, sessionId: input.sessionId }
      : { inputKind: 'conversation_turn', userId: input.userId, workspaceId: input.workspaceId, conversationSessionId: conversationSessionId! },
    now,
  );
  if (!fresh.decision.allow) throw new Error('catalog_access_denied');
  const { decision } = fresh;

  const membership = await findCmApprovedMembership(input.userId, decision.tenantId);
  const { rows: [wsRow] } = await tx.hostTransaction.query<{ type: string }>(
    'SELECT type FROM public.workspaces WHERE id = $1 AND hidden_at IS NULL', [input.workspaceId]);
  if (!wsRow) throw new Error('catalog_access_denied');

  const policyVersion = createHash('sha256').update(
    [decision.tid, decision.tenantRole, decision.workspaceRole, membership?.updatedAt.toISOString() ?? '', decision.scopes.join(',')].join('|'),
  ).digest('hex');

  const names = [...fresh.allowedTools];
  if (process.env.APP_ARTIFACT_HOST_ENABLED === '1') {
    // The compiled registry owns public identifiers; never sanitize or reconstruct them here.
    names.push(...(await prepareHostRegistryCatalog())!.tools.keys());
  }
  return { tenantId: decision.tenantId, membershipRef: `${input.workspaceId}:${input.userId}:${decision.workspaceRole}`,
    consentRef: `first-party:${input.kind}:${input.sessionId}`,
    policyVersion,
    roles: [decision.workspaceRole], workspaceType: wsRow?.type, readOnly: !['editor', 'admin'].includes(decision.workspaceRole),
    allowedTools: [...new Set(names)] };
}));

export const resolveHttpCatalogContext = (user: AuthUser) => resolve({ kind: 'http',
  userId: user?.userId, sessionId: user?.sessionId, workspaceId: user?.workspaceId });

export const resolveTurnCatalogContext = (turn: Omit<CatalogContextInput, 'kind'>) =>
  resolve({ ...turn, kind: 'turn' });
