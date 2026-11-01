// Lot A4: replacement for the deleted registration.ts / account.ts.
//
// - /me account lifecycle (read, deactivate, delete) runs over the CM facades
//   (cm-users, cm-sessions) and the A2.3 atomic cascade (account-deletion).
// - /auth/register/* keeps the auth-hono route surface, with every identity
//   read/write served from the CM stores: user port via cm-users, invites via
//   cm-proofs (single-use consume at persist), credentials via the CM
//   webauthn adapter, sessions via session-manager over cm-sessions.
//
// STACK DEPENDENCY (r6 §4.7, domain authentication_completion 1.1.0): the
// completion flows of these handlers are to run inside the A2.0b CM-owned
// auth-hono transaction binding — createIdentityAuthHonoTransactionBindingV1 /
// runIdentityAuthCompletionV1 under packages/cluster-mesh/src/identity/,
// exported from @sentropic/cluster-mesh. That module lands on
// feat/cm-identity-a2-0b; this branch codes against the contract and is
// rebased onto main once A2.0b merges. No legacy identity table is read here.

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  createAuthWebAuthnRegistrationRouteHandlers,
  type AuthHonoBeforePersistCredential,
  type AuthHonoFinalizeRegistration,
  type AuthHonoPrepareRegistrationOptions,
  type AuthHonoResolveRegistrationUser,
} from '@sentropic/auth-hono';

import { env } from '../../../config/env';
import { db } from '../../../db/client';
import { workspaces } from '../../../db/schema';
import { logger } from '../../../logger';
import { authHonoWebAuthnRegistrationService } from '../../../services/auth/webauthn-adapter';
import { createInviteStoreAdapter, hashInviteToken } from '../../../services/auth/invite-store-adapter';
import { verifyValidationToken } from '../../../services/email-verification';
import { createSession, revokeAllSessions } from '../../../services/session-manager';
import { ensureWorkspaceForUser } from '../../../services/workspace-service';
import { deriveDisplayNameFromEmail } from '../../../utils/display-name';
import { findCmUserById, findCmUserByEmail, countCmUsersWithRole, createCmUser, updateCmUser } from '../../../services/identity/cm-users';
import { listCmCredentialsForUser } from '../../../services/identity/cm-proofs';
import { listCmSessionsForUser } from '../../../services/identity/cm-sessions';
import { tombstoneRemoteSessions } from '../../../services/auth/remote-revocation';
import { remoteRevocationError } from '../../../services/auth/remote-revocation-error';
import { deleteAccountAtomically } from '../../../services/auth/account-deletion';

// ---------------------------------------------------------------------------
// /me — account lifecycle over the CM stores
// ---------------------------------------------------------------------------

export const accountRouter = new Hono();
accountRouter.onError((error, c) => remoteRevocationError(error, c, true));

accountRouter.get('/', async (c) => {
  const { userId, workspaceId, role } = c.get('user');

  const user = await findCmUserById(userId);

  const [ws] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return c.json({
    user,
    workspace: ws ?? null,
    // role can be dynamically downgraded (approval expired => guest)
    effectiveRole: role,
  });
});

accountRouter.post('/deactivate', async (c) => {
  const { userId } = c.get('user');
  const now = new Date();

  await updateCmUser(userId, {
    accountStatus: 'disabled_by_user',
    disabledAt: now,
    disabledReason: 'user_deactivated',
    updatedAt: now,
  });

  // Revoke sessions immediately
  await revokeAllSessions(userId);

  return c.json({ success: true });
});

/**
 * DELETE /me
 * Immediate account suppression through the A2.3 atomic cascade: the account
 * is disabled first (the cascade requires a disabled account), then identity
 * AND business rows are removed in one transaction. A failure rolls back
 * everything — no orphan, no partial deletion.
 */
accountRouter.delete('/', async (c) => {
  const { userId, workspaceId } = c.get('user');
  const now = new Date();

  await updateCmUser(userId, {
    accountStatus: 'disabled_by_user',
    disabledAt: now,
    disabledReason: 'user_deleted',
    updatedAt: now,
  });

  const sessionIds = (await listCmSessionsForUser(userId)).map((row) => row.id);
  const { receipt, remoteRevocationKey } = await deleteAccountAtomically({
    userId,
    actorId: userId,
    handlerId: 'self_account',
    workspaceId,
  });

  if (receipt.transaction !== 'committed') {
    return c.json({ error: 'Account deletion rolled back', resultCode: receipt.resultCode }, 409);
  }

  // Only after a successful commit — a rolled-back transaction must not leave
  // a revoked grant or a tombstoned remote session behind for a live account.
  await tombstoneRemoteSessions({ sessionIds, userId }, remoteRevocationKey ?? undefined);

  return c.json({ success: true });
});

