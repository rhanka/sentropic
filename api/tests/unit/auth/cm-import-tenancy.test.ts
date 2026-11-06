import { describe, expect, it } from 'vitest';
import { mapA4TenantMembership, mapA4Workspace, mapA4WorkspaceMembership } from '../../../src/services/identity/cm-import-tenancy';

describe('A4 independent tenant and workspace membership mapping', () => {
  it('should preserve a suspended tenant membership even for a workspace admin', () => {
    expect(mapA4TenantMembership({ user_id: 'user', tenant_id: 'tenant', status: 'suspended', role: 'member',
      approved_by_user_id: 'decider', decided_at: '2026-10-30T12:00:00',
      created_at: '2026-10-29T12:00:00', updated_at: '2026-10-30T12:00:00' }))
      .toEqual({ userId: 'user', tenantId: 'tenant', status: 'suspended', tenantRole: 'member',
        decidedBy: 'decider', decidedAt: '2026-10-30T12:00:00.000Z', updatedAt: '2026-10-30T12:00:00.000Z' });
    expect(mapA4WorkspaceMembership({ workspace_id: 'workspace', user_id: 'user', role: 'admin' }))
      .toEqual({ workspaceId: 'workspace', userId: 'user', role: 'admin' });
  });

  it('should retain a repo-less workspace id and tenant without inventing a repository', () => {
    expect(mapA4Workspace({ id: 'workspace', tenant_id: 'tenant', created_at: '2026-10-29T12:00:00' }))
      .toEqual({ workspaceId: 'workspace', tenantId: 'tenant', repoIdentity: null, aliases: [], enrolledAt: '2026-10-29T12:00:00.000Z' });
  });
});
