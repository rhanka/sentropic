import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelfActionForbiddenError } from '@sentropic/cluster-mesh';

import { CmIdentityForbiddenError } from '../../../src/services/identity/cm-deletion-authorization';
import { decideMembership, requestMembership } from '../../../src/services/identity/cm-membership';
import { createCmTenant, findCmMembership, setCmMembershipState } from '../../../src/services/identity/cm-tenancy';
import { cleanupAuthData, createTestUser } from '../../utils/auth-helper';
import { cmDeleteTenantMembershipsForTenant, cmDeleteTenants, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

// A4 makes tenant membership explicit: after the cutover a tenant can have no approved member, and
// self-approval is refused, so nobody could ever become its first member. One bounded exception:
// an active admin_app approves its OWN pending request while the tenant has no approved member.
let tenantId = '';
const audit = (userId: string) => cmQuery(`SELECT kind, actor_id FROM ${cmTable('cm_identity_audit_events')}
  WHERE subject_id = $1 ORDER BY at`, [`${userId}/${tenantId}`]);
const status = async (userId: string) => (await findCmMembership(userId, tenantId))?.status;

describe('first-member tenant bootstrap', () => {
  beforeEach(async () => {
    tenantId = `fm-boot-${crypto.randomUUID()}`;
    await createCmTenant({ tenantId, slug: tenantId });
  });
  afterEach(async () => {
    await cmDeleteTenantMembershipsForTenant(tenantId);
    await cmDeleteTenants([tenantId]);
    await cleanupAuthData();
  });

  it('should let an active admin_app approve its own request when the tenant has no approved member', async () => {
    const admin = await createTestUser({ role: 'admin_app', withWorkspace: false });
    await requestMembership(admin.id, tenantId);
    expect(await decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'approve'))
      .toEqual({ status: 'approved' });
    expect(await findCmMembership(admin.id, tenantId)).toMatchObject({ status: 'approved', role: 'member',
      decidedBy: admin.id });
    expect(await audit(admin.id)).toEqual([{ kind: 'membership.approved', actor_id: admin.id }]);
  });

  it('should refuse a second self-approval once the tenant has an approved member', async () => {
    const first = await createTestUser({ role: 'admin_app', withWorkspace: false });
    const second = await createTestUser({ role: 'admin_app', withWorkspace: false });
    await requestMembership(first.id, tenantId);
    await requestMembership(second.id, tenantId);
    await decideMembership(first.id, 'admin_app', tenantId, first.id, 'approve');
    await expect(decideMembership(second.id, 'admin_app', tenantId, second.id, 'approve'))
      .rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await status(second.id)).toBe('requested');
    // The first member approves the others through the ordinary path.
    expect(await decideMembership(first.id, 'admin_app', tenantId, second.id, 'approve'))
      .toEqual({ status: 'approved' });
  });

  it('should refuse first-member self-approval for a caller without the admin_app role', async () => {
    const editor = await createTestUser({ role: 'editor', withWorkspace: false });
    await requestMembership(editor.id, tenantId);
    await expect(decideMembership(editor.id, 'admin_app', tenantId, editor.id, 'approve'))
      .rejects.toBeInstanceOf(CmIdentityForbiddenError);
    expect(await status(editor.id)).toBe('requested');
  });

  it.each(['invited', 'suspended'] as const)('should refuse first-member self-approval of a %s membership', async (state) => {
    const admin = await createTestUser({ role: 'admin_app', withWorkspace: false });
    await setCmMembershipState(admin.id, tenantId, { status: state, decidedBy: 'first-member-test' });
    await expect(decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'approve'))
      .rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await status(admin.id)).toBe(state);
  });

  it('should refuse first-member self-approval without a pending request', async () => {
    const admin = await createTestUser({ role: 'admin_app', withWorkspace: false });
    await expect(decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'approve'))
      .rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await status(admin.id)).toBeUndefined();
  });

  it('should keep self-rejection refused and self-suspension allowed', async () => {
    const admin = await createTestUser({ role: 'admin_app', withWorkspace: false });
    await requestMembership(admin.id, tenantId);
    await expect(decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'reject'))
      .rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await status(admin.id)).toBe('requested');
    await decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'approve');
    expect(await decideMembership(admin.id, 'admin_app', tenantId, admin.id, 'suspend'))
      .toEqual({ status: 'suspended' });
  });
});
