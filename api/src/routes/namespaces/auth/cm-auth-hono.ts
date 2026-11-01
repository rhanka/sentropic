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

// ---------------------------------------------------------------------------
// /auth/register/* — auth-hono route surface over the CM identity stores
// ---------------------------------------------------------------------------

/**
 * BR-39r L4 — single-use invitation tokens (invitation → direct device enrollment).
 * The invite store is the CM invitation store (cm-proofs); the token is consumed
 * atomically exactly once at credential-persist time. C3 (no account-enumeration):
 * every invalid invite state collapses into the generic cold-register fallback.
 */
const INVITE_TOKEN_PREFIX = 'sit_';
const isInviteToken = (token: string | undefined): token is string =>
  typeof token === 'string' && token.startsWith(INVITE_TOKEN_PREFIX);

const invites = createInviteStoreAdapter();

/** Read-only: is this invite token currently valid AND bound to `normalizedEmail`? Never consumes. */
const inviteMatchesEmail = async (token: string, normalizedEmail: string): Promise<boolean> => {
  const valid = await invites.findValid(hashInviteToken(token), new Date());
  return Boolean(valid && valid.email.trim().toLowerCase() === normalizedEmail);
};

// C3 no-account-enumeration: the generic "verify your email to continue" outcome.
const emailVerificationRequired = () => ({
  error: {
    code: 'email_verification_required' as const,
    message: "Vous devez vérifier votre email avec un code avant d'enregistrer un device",
    status: 403 as const,
  },
});

const prepareSentropicRegistrationOptions: AuthHonoPrepareRegistrationOptions = async ({
  email,
  verificationToken,
}) => {
  const normalizedEmail = email.trim().toLowerCase();

  let hasInvite = false;
  if (isInviteToken(verificationToken)) {
    hasInvite = await inviteMatchesEmail(verificationToken, normalizedEmail);
    if (!hasInvite) {
      logger.warn({ email: normalizedEmail }, 'Invite token invalid or not bound to this email');
      return emailVerificationRequired();
    }
  }
  const emailToken = isInviteToken(verificationToken) ? undefined : verificationToken;

  if (emailToken) {
    const tokenValidation = await verifyValidationToken(emailToken);
    if (!tokenValidation.valid || tokenValidation.email !== normalizedEmail) {
      logger.warn({ email: normalizedEmail }, 'Invalid verification token');
      return {
        error: {
          code: 'invalid_verification_token',
          message: 'Le token de vérification est invalide ou expiré',
          status: 403,
        },
      };
    }
  }

  // Unified "the email is proven" flag: a verified email token OR a valid invite for this email.
  const hasProof = Boolean(emailToken) || hasInvite;

  const defaultDisplayName = deriveDisplayNameFromEmail(normalizedEmail);

  const existingUser = await findCmUserByEmail(normalizedEmail);

  if (existingUser) {
    if (!existingUser.emailVerified && !hasInvite) {
      logger.warn({ email: normalizedEmail, userId: existingUser.id }, 'Email not verified - registration blocked');
      return emailVerificationRequired();
    }

    logger.info({ email: normalizedEmail, role: existingUser.role, userId: existingUser.id }, 'Registration options generated');
    return {
      serviceInput: {
        userDisplayName: existingUser.displayName ?? defaultDisplayName,
        userId: existingUser.id,
        userName: normalizedEmail,
      },
      userId: existingUser.id,
    };
  }

  if (!hasProof) {
    logger.warn({ email: normalizedEmail }, 'Email not verified - verification token required');
    return emailVerificationRequired();
  }

  let userRole = 'editor';
  if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
    if ((await countCmUsersWithRole('admin_app')) === 0) {
      userRole = 'admin_app';
      logger.info({ email: normalizedEmail }, 'Admin user registration detected');
    }
  }

  const userId = crypto.randomUUID();
  logger.info({ email: normalizedEmail, role: userRole, userId }, 'New user registration - temporary userId created for challenge');

  return {
    serviceInput: {
      userDisplayName: defaultDisplayName,
      userName: normalizedEmail,
    },
    userId,
  };
};

