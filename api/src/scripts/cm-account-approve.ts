#!/usr/bin/env tsx
//
// Governed one-off account approval (role change) for a cm_identity account.
//
// The admin API (`POST /api/v1/admin/identity/users/:id/approve`) needs an existing admin_app
// session, so an environment without one has no operator path to change a role. This script
// calls the SAME service as that route, `changeCmAccountAsAdmin`, so the account audit event,
// the custody profile approval fields and the subject revision are written exactly as by the
// admin API. It never writes the identity tables itself.
//
// Intended as a one-off Job (`make cm-account-approve-job`, deploy/k8s/base/38-*) run with the
// target namespace's api image against that namespace's database.
//
// Required env (all four; the wrapper refuses any other key in the operator env file):
//   CM_ACCOUNT_APPROVE_ACTOR_ID  user id of an ACTIVE admin_app account with a custody profile
//   CM_ACCOUNT_APPROVE_USER_ID   user id of the account to approve; must differ from the actor
//   CM_ACCOUNT_APPROVE_ROLE      one of admin_app | admin_org | editor | guest
//   CM_ACCOUNT_APPROVE_REASON    non-empty operator reason (max 256 characters); the wrapper
//                                records it as the Job annotation and in its receipt line
//
// Output: one JSON line {userId, roleBefore, roleAfter, status}. Exit code 1 on any refusal.

import { pathToFileURL } from 'node:url';

import type { GlobalRole, UserAccount } from '@sentropic/cluster-mesh';

export const CM_ACCOUNT_APPROVE_ROLES = ['admin_app', 'admin_org', 'editor', 'guest'] as const satisfies readonly GlobalRole[];
export const CM_ACCOUNT_APPROVE_REASON_MAX = 256;

export interface CmAccountApproveRequest {
  readonly actorId: string;
  readonly userId: string;
  readonly role: GlobalRole;
  readonly reason: string;
}

export interface CmAccountApproveResult {
  readonly userId: string;
  readonly roleBefore: GlobalRole;
  readonly roleAfter: GlobalRole;
  readonly status: UserAccount['accountStatus'];
}

export interface CmAccountApproveDeps {
  readonly readAccount: (userId: string) => Promise<UserAccount | null>;
  readonly approve: (input: {
    readonly actorId: string; readonly userId: string;
    readonly action: { readonly kind: 'approve'; readonly role: GlobalRole };
  }) => Promise<void>;
}

const requireEnv = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
};

const isRole = (value: string): value is GlobalRole =>
  (CM_ACCOUNT_APPROVE_ROLES as readonly string[]).includes(value);

/** Pure env parser: every refusal happens here, before any database access. */
export const parseCmAccountApproveRequest = (source: NodeJS.ProcessEnv = process.env): CmAccountApproveRequest => {
  const actorId = requireEnv(source, 'CM_ACCOUNT_APPROVE_ACTOR_ID');
  const userId = requireEnv(source, 'CM_ACCOUNT_APPROVE_USER_ID');
  const role = requireEnv(source, 'CM_ACCOUNT_APPROVE_ROLE');
  const reason = requireEnv(source, 'CM_ACCOUNT_APPROVE_REASON');
  if (!isRole(role)) {
    throw new Error(`Unsupported CM_ACCOUNT_APPROVE_ROLE '${role}'. Use one of ${CM_ACCOUNT_APPROVE_ROLES.join(', ')}.`);
  }
  if (actorId === userId) throw new Error('Refusing self-approval: CM_ACCOUNT_APPROVE_ACTOR_ID equals CM_ACCOUNT_APPROVE_USER_ID.');
  if (reason.length > CM_ACCOUNT_APPROVE_REASON_MAX) {
    throw new Error(`CM_ACCOUNT_APPROVE_REASON exceeds ${CM_ACCOUNT_APPROVE_REASON_MAX} characters.`);
  }
  return { actorId, userId, role, reason };
};

/** Approve through the admin service, then read back the role and status it committed. */
export const runCmAccountApprove = async (
  request: CmAccountApproveRequest, deps: CmAccountApproveDeps,
): Promise<CmAccountApproveResult> => {
  const before = await deps.readAccount(request.userId);
  if (!before) throw new Error('Target account not found.');
  await deps.approve({ actorId: request.actorId, userId: request.userId, action: { kind: 'approve', role: request.role } });
  const after = await deps.readAccount(request.userId);
  if (!after) throw new Error('Target account missing after approval.');
  if (after.globalRole !== request.role || after.accountStatus !== 'active') {
    throw new Error('Approval did not commit the requested role and active status.');
  }
  return { userId: request.userId, roleBefore: before.globalRole, roleAfter: after.globalRole, status: after.accountStatus };
};

const main = async (): Promise<void> => {
  const request = parseCmAccountApproveRequest();
  const [{ changeCmAccountAsAdmin }, { runCmIdentityRead }] = await Promise.all([
    import('../services/identity/cm-account-administration'),
    import('../services/identity/cm-transaction'),
  ]);
  const result = await runCmAccountApprove(request, {
    readAccount: userId => runCmIdentityRead(tx => tx.stores.accounts.findAccount(userId)),
    approve: changeCmAccountAsAdmin,
  });
  console.log(JSON.stringify(result));
};

// Only run when executed directly (kubectl Job). Importing this module from a unit test is side-effect-free.
const entrypoint = process.argv[1];
const invokedDirectly = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    // Error class and FIRST message line only (as oauth-register-service-client): never the env, never a
    // stack, never a wrapped driver DETAIL line carrying bound values.
    const message = error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : 'unknown error';
    console.error(`cm-account-approve refused: ${message}`);
    process.exitCode = 1;
  } finally {
    const { pool } = await import('../db/client');
    await pool.end();
  }
}
