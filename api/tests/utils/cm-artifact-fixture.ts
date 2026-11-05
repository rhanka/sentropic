import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** CM rows in the artifact suite's private database; no global app pool or legacy table. */
export async function seedCmArtifactIdentity(pool: Pool, options: {
  userId?: string; otherUsers?: string[]; tenantId?: string; workspaceId?: string;
  role?: 'viewer' | 'editor'; sessionIds?: string[];
  additionalScopes?: { workspaceId: string; tenantId: string }[];
} = {}) {
  const { userId = 'alice', otherUsers = [], tenantId = 'tenant-a', workspaceId = 'workspace-a',
    role = 'editor', sessionIds = ['session-a'], additionalScopes = [] } = options;
  const now = new Date().toISOString(), expires = new Date(Date.now() + 3_600_000).toISOString();
  for (const id of [userId, ...otherUsers]) {
    await pool.query(`INSERT INTO cm_identity.identity_user_accounts
      (user_id, email, account_status, global_role, created_at, updated_at) VALUES ($1, $2, 'active', 'editor', $3, $3)`,
    [id, `${id}@example.test`, now]);
    await pool.query(`INSERT INTO cm_identity.identity_account_profiles (user_id, email_verified, legacy_account_status)
      VALUES ($1, true, 'active')`, [id]);
  }
  for (const scope of [{ workspaceId, tenantId }, ...additionalScopes]) {
    await pool.query(`INSERT INTO cm_identity.cm_tenants (tenant_id, slug, status, created_at)
      VALUES ($1, $1, 'active', $2)`, [scope.tenantId, now]);
    await pool.query(`INSERT INTO public.workspaces (id, name) VALUES ($1, $1)`, [scope.workspaceId]);
    await pool.query(`INSERT INTO cm_identity.cm_workspaces (workspace_id, tenant_id, enrolled_at)
      VALUES ($1, $2, $3)`, [scope.workspaceId, scope.tenantId, now]);
    await pool.query(`INSERT INTO cm_identity.cm_tenant_memberships
      (user_id, tenant_id, status, tenant_role, decided_by, decided_at, updated_at)
      VALUES ($1, $2, 'approved', 'member', $1, $3, $3)`, [userId, scope.tenantId, now]);
    await pool.query(`INSERT INTO cm_identity.cm_workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, $3)`, [scope.workspaceId, userId, role]);
  }
  for (const id of sessionIds) {
    await pool.query(`INSERT INTO cm_identity.identity_login_sessions
      (session_id, user_id, status, mfa_state, created_at, expires_at, refresh_count)
      VALUES ($1, $2, 'active', 'none', $3, $4, 0)`, [id, userId, now, expires]);
    await pool.query(`INSERT INTO cm_identity.identity_login_token_bindings
      (session_id, session_token_hash, mfa_verified, auth_time, session_version, rotation_version)
      VALUES ($1, $2, 0, $3, $4, 1)`, [id, createHash('sha256').update(id).digest('hex'),
    Math.floor(Date.parse(now) / 1000), Date.parse(now)]);
  }
}

export async function seedCmArtifactConversation(pool: Pool, chatId = 'turn-a') {
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO cm_identity.cm_identity_conversation_sessions
    (conversation_session_id, user_id, workspace_id, status, opened_at, expires_at)
    VALUES ($1, 'alice', 'workspace-a', 'active', $2, $3)`,
  [`authority:${chatId}`, now, new Date(Date.now() + 3_600_000).toISOString()]);
  await pool.query(`INSERT INTO public.chat_sessions (id, user_id, workspace_id, cm_conversation_session_id)
    VALUES ($1, 'alice', 'workspace-a', $2)`, [chatId, `authority:${chatId}`]);
}
