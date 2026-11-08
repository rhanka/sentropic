/**
 * Governed one-off account approval: pure env parser and the service-call runner.
 * No DB: the services are injected; the script touches the database only when invoked directly.
 */
import { describe, expect, it, vi } from 'vitest';
import type { UserAccount } from '@sentropic/cluster-mesh';

import {
  CM_ACCOUNT_APPROVE_ROLES,
  parseCmAccountApproveRequest,
  runCmAccountApprove,
  type CmAccountApproveDeps,
} from '../../src/scripts/cm-account-approve';

const env: NodeJS.ProcessEnv = {
  CM_ACCOUNT_APPROVE_ACTOR_ID: 'user-admin',
  CM_ACCOUNT_APPROVE_USER_ID: 'user-target',
  CM_ACCOUNT_APPROVE_ROLE: 'admin_app',
  CM_ACCOUNT_APPROVE_REASON: 'owner authorization 2026-11-08 01:58',
};
const account = (extra: Partial<UserAccount> = {}): UserAccount => ({
  userId: 'user-target', email: 'target@example.com', accountStatus: 'active', globalRole: 'guest',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...extra,
});
const deps = (before: UserAccount | null, after: UserAccount | null): CmAccountApproveDeps & {
  approve: ReturnType<typeof vi.fn>; readAccount: ReturnType<typeof vi.fn>;
} => ({
  readAccount: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
  approve: vi.fn().mockResolvedValue(undefined),
});

describe('parseCmAccountApproveRequest', () => {
  it('parses the four variables and trims them', () => {
    expect(parseCmAccountApproveRequest({ ...env, CM_ACCOUNT_APPROVE_USER_ID: '  user-target  ' })).toEqual({
      actorId: 'user-admin', userId: 'user-target', role: 'admin_app', reason: 'owner authorization 2026-11-08 01:58',
    });
  });

  it('refuses each missing or blank variable', () => {
    for (const name of Object.keys(env)) {
      expect(() => parseCmAccountApproveRequest({ ...env, [name]: undefined })).toThrow(`Missing required env ${name}`);
      expect(() => parseCmAccountApproveRequest({ ...env, [name]: '   ' })).toThrow(`Missing required env ${name}`);
    }
  });

  it('refuses self-approval', () => {
    expect(() => parseCmAccountApproveRequest({ ...env, CM_ACCOUNT_APPROVE_USER_ID: 'user-admin' }))
      .toThrow(/Refusing self-approval/);
  });

  it('accepts only the GlobalRole enum', () => {
    expect(CM_ACCOUNT_APPROVE_ROLES).toEqual(['admin_app', 'admin_org', 'editor', 'guest']);
    for (const role of CM_ACCOUNT_APPROVE_ROLES) {
      expect(parseCmAccountApproveRequest({ ...env, CM_ACCOUNT_APPROVE_ROLE: role }).role).toBe(role);
    }
    for (const role of ['admin', 'ADMIN_APP', 'owner', 'admin_app,editor']) {
      expect(() => parseCmAccountApproveRequest({ ...env, CM_ACCOUNT_APPROVE_ROLE: role }))
        .toThrow(/Unsupported CM_ACCOUNT_APPROVE_ROLE/);
    }
  });

  it('bounds the reason length', () => {
    expect(() => parseCmAccountApproveRequest({ ...env, CM_ACCOUNT_APPROVE_REASON: 'x'.repeat(257) })).toThrow(/exceeds 256/);
  });
});

describe('runCmAccountApprove', () => {
  const request = parseCmAccountApproveRequest(env);

  it('calls the admin service with the actor, the target and an approve action carrying the role', async () => {
    const d = deps(account(), account({ globalRole: 'admin_app' }));
    const result = await runCmAccountApprove(request, d);
    expect(d.approve).toHaveBeenCalledTimes(1);
    expect(d.approve).toHaveBeenCalledWith({ actorId: 'user-admin', userId: 'user-target', action: { kind: 'approve', role: 'admin_app' } });
    expect(d.readAccount).toHaveBeenNthCalledWith(1, 'user-target');
    expect(d.readAccount).toHaveBeenNthCalledWith(2, 'user-target');
    expect(result).toEqual({ userId: 'user-target', roleBefore: 'guest', roleAfter: 'admin_app', status: 'active' });
  });

  it('outputs only userId, roleBefore, roleAfter and status: no actor, reason or email', async () => {
    const result = await runCmAccountApprove(request, deps(account(), account({ globalRole: 'admin_app' })));
    expect(Object.keys(result).sort()).toEqual(['roleAfter', 'roleBefore', 'status', 'userId']);
    const printed = JSON.stringify(result);
    for (const value of ['user-admin', env.CM_ACCOUNT_APPROVE_REASON as string, 'target@example.com']) {
      expect(printed).not.toContain(value);
    }
  });

  it('refuses an unknown target before calling the service', async () => {
    const d = deps(null, null);
    await expect(runCmAccountApprove(request, d)).rejects.toThrow('Target account not found.');
    expect(d.approve).not.toHaveBeenCalled();
  });

  it('propagates a service refusal (for example a non-admin actor)', async () => {
    const d = deps(account(), account());
    d.approve.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(runCmAccountApprove(request, d)).rejects.toThrow('Forbidden');
    expect(d.readAccount).toHaveBeenCalledTimes(1);
  });

  it('fails when the read-back does not show the requested role and active status', async () => {
    await expect(runCmAccountApprove(request, deps(account(), account({ globalRole: 'guest' }))))
      .rejects.toThrow(/did not commit/);
    await expect(runCmAccountApprove(request, deps(account(), account({ globalRole: 'admin_app', accountStatus: 'disabled' }))))
      .rejects.toThrow(/did not commit/);
  });
});
