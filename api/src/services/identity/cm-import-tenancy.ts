import type { TenantRecord, TenantMembershipRecord, WorkspaceRecord, WorkspaceMembershipRecord,
  OAuthConsentRecord, ServiceClientBinding } from '@sentropic/cluster-mesh';
import { sourceChoice as choice, sourceNullableText as nullable, sourceNullableTime as nullableTime,
  sourceText as text, sourceTime as time, type A4SourceRow } from './cm-import-values';

export const mapA4Tenant = (row: A4SourceRow): TenantRecord => ({
  tenantId: text(row.id), slug: text(row.id),
  status: choice(row.status, ['active', 'suspended', 'offboarded']), createdAt: time(row.created_at),
});

export function mapA4TenantMembership(row: A4SourceRow): TenantMembershipRecord {
  const decidedBy = nullable(row.approved_by_user_id), decidedAt = nullableTime(row.decided_at);
  return { userId: text(row.user_id), tenantId: text(row.tenant_id),
    status: choice(row.status, ['invited', 'requested', 'approved', 'rejected', 'suspended']),
    tenantRole: choice(row.role, ['member', 'admin']),
    ...(decidedBy === null ? {} : { decidedBy }), ...(decidedAt === null ? {} : { decidedAt }),
    updatedAt: time(row.updated_at ?? row.created_at) };
}

export const mapA4Workspace = (row: A4SourceRow): WorkspaceRecord => ({
  workspaceId: text(row.id), tenantId: text(row.tenant_id), repoIdentity: null, aliases: [], enrolledAt: time(row.created_at),
});

export const mapA4WorkspaceMembership = (row: A4SourceRow): WorkspaceMembershipRecord => ({
  workspaceId: text(row.workspace_id), userId: text(row.user_id), role: choice(row.role, ['viewer', 'commenter', 'editor', 'admin']),
});

export function mapA4OAuthConsent(row: A4SourceRow): OAuthConsentRecord {
  const userId = text(row.user_id), clientId = text(row.client_id), tenantId = text(row.tenant_id);
  // The source key is (user, client, tenant); a deleted consent has no live source row.
  return { consentId: cmOAuthConsentId(userId, clientId, tenantId), tenantId, userId,
    clientId, grantedAt: time(row.created_at) };
}

export const cmOAuthConsentId = (userId: string, clientId: string, tenantId: string): string =>
  createHash('sha256').update(JSON.stringify(['app-oauth-consent', userId, clientId, tenantId])).digest('hex');

export const mapA4ServiceClient = (row: A4SourceRow): ServiceClientBinding => ({
  clientId: text(row.client_id), tenantId: text(row.tenant_id), boundAt: time(row.created_at),
});
import { createHash } from 'node:crypto';
