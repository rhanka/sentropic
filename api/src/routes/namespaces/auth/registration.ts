import {
  createAuthWebAuthnRegistrationRouteHandlers,
  type AuthHonoBeforePersistCredential,
  type AuthHonoFinalizeRegistration,
  type AuthHonoPrepareRegistrationOptions,
  type AuthHonoResolveRegistrationUser,
} from '@sentropic/auth-hono';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { env } from '../../../config/env';
import { db } from '../../../db/client';
import { users, webauthnCredentials } from '../../../db/schema';
import { logger } from '../../../logger';
import { authHonoWebAuthnRegistrationService } from '../../../services/auth/webauthn-adapter';
import { createInviteStoreAdapter, hashInviteToken } from '../../../services/auth/invite-store-adapter';
import { verifyValidationToken } from '../../../services/email-verification';
import { createSession } from '../../../services/session-manager';
import { ensureWorkspaceForUser } from '../../../services/workspace-service';
import { deriveDisplayNameFromEmail } from '../../../utils/display-name';

/**
 * BR-39r L4 — single-use invitation tokens (invitation → direct device enrollment).
 *
 * An invite token is recognizable by the opaque `sit_` prefix (vs an email-verification JWT).
 * It is validated read-only at options/resolve time only to decide whether to SKIP the email
 * step, and is CONSUMED ATOMICALLY exactly once at credential-persist time (`resolveBeforePersist`
 * → `invites.consume`), after the WebAuthn response is verified but before the credential row is
 * written. C3 (no account-enumeration): EVERY invalid invite state (unknown / expired / consumed /
 * email-mismatch) collapses into the generic cold-register fallback — there is no `invalid_invite`
 * signal; an invalid invite simply behaves like a normal registration (email verification required).
 */
const INVITE_TOKEN_PREFIX = 'sit_';
const isInviteToken = (token: string | undefined): token is string =>
  typeof token === 'string' && token.startsWith(INVITE_TOKEN_PREFIX);

const invites = createInviteStoreAdapter();

/**
 * Read-only: is this invite token currently valid AND bound to `normalizedEmail`?
 * Any negative answer (unknown / expired / consumed / email-mismatch) returns false → the caller
 * falls through to the generic email-first behavior (C3 no-enumeration). Never consumes.
 */
const inviteMatchesEmail = async (token: string, normalizedEmail: string): Promise<boolean> => {
  const valid = await invites.findValid(hashInviteToken(token), new Date());
  return Boolean(valid && valid.email.trim().toLowerCase() === normalizedEmail);
};

/**
 * WebAuthn Registration Routes (`@sentropic/auth-hono`)
 *
 * POST /auth/register/options - Generate registration options
 * POST /auth/register/verify  - Verify registration response + create session
 */

export const registerRouter = new Hono();

// C3 no-account-enumeration: the generic "verify your email to continue" outcome. EVERY invalid
// invite state (unknown / expired / consumed / email-mismatch) AND a cold register without proof
// collapse into THIS identical 403 — so an attacker holding any syntactic `sit_` token cannot
// distinguish an existing-verified email from an unknown one.
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

  // BR-39r L4 (C3): when a SYNTACTIC `sit_` invite token is present, evaluate the invite UNIFORMLY
  // BEFORE the existing-user short-circuit. An invite that is NOT valid for this email
  // (unknown/expired/consumed/mismatch) returns the GENERIC `email_verification_required` (403)
  // here — identical for existing-verified, existing-unverified, and unknown emails (no enumeration).
  // A valid invite is proof-of-email and PROCEEDS for both new AND existing-unverified users.
  let hasInvite = false;
  if (isInviteToken(verificationToken)) {
    hasInvite = await inviteMatchesEmail(verificationToken, normalizedEmail);
    if (!hasInvite) {
      logger.warn({ email: normalizedEmail }, 'Invite token invalid or not bound to this email');
      return emailVerificationRequired();
    }
  }
  // The remaining email-token path only applies to non-invite tokens.
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
    logger.info({ email: normalizedEmail }, 'Verification token validated for registration');
  }

  // Unified "the email is proven" flag: a verified email token OR a valid invite for this email.
  const hasProof = Boolean(emailToken) || hasInvite;

  const emailLocalPart = normalizedEmail.split('@')[0] ?? normalizedEmail;
  const defaultDisplayName = deriveDisplayNameFromEmail(normalizedEmail);

  let existingUser;
  const [emailUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  existingUser = emailUser;

  if (!existingUser) {
    const [displayNameUser] = await db
      .select()
      .from(users)
      .where(eq(users.displayName, normalizedEmail))
      .limit(1);
    existingUser = displayNameUser;
  }

  if (!existingUser) {
    const [legacyDisplayUser] = await db
      .select()
      .from(users)
      .where(eq(users.displayName, emailLocalPart))
      .limit(1);
    existingUser = legacyDisplayUser;
  }

  if (existingUser) {
    const userId = existingUser.id;
    const userRole = existingUser.role as 'admin_app' | 'admin_org' | 'editor' | 'guest';

    if (!existingUser.email && normalizedEmail) {
      await db
        .update(users)
        .set({
          displayName: existingUser.displayName ?? defaultDisplayName,
          email: normalizedEmail,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
    }

    logger.info(
      { email: existingUser.email ?? normalizedEmail, userId },
      'Using existing user for registration'
    );

    // A valid invite for this email is proof-of-email → an existing-UNVERIFIED user proceeds (the
    // invite stands in for the email-code step). Without proof, an unverified existing user is still
    // blocked with the SAME generic 403 as a cold register (C3: no enumeration signal).
    if (!existingUser.emailVerified && !hasInvite) {
      logger.warn({ email: normalizedEmail, userId }, 'Email not verified - registration blocked');
      return emailVerificationRequired();
    }

    logger.info({ email: normalizedEmail, role: userRole, userId }, 'Registration options generated');
    return {
      serviceInput: {
        userDisplayName: defaultDisplayName,
        userId,
        userName: normalizedEmail,
      },
      userId,
    };
  }

  if (!hasProof) {
    // No proof of email (no valid email token AND no valid invite for this email). C3: an invalid
    // invite is indistinguishable from a cold register here — same generic message.
    logger.warn({ email: normalizedEmail }, 'Email not verified - verification token required');
    return emailVerificationRequired();
  }

  let userRole: 'admin_app' | 'admin_org' | 'editor' | 'guest' = 'editor';
  if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
    const existingAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin_app'))
      .limit(1);
    if (existingAdmins.length === 0) {
      userRole = 'admin_app';
      logger.info({ email: normalizedEmail }, 'Admin user registration detected');
    } else {
      logger.info(
        { email: normalizedEmail },
        'Admin email used but admin already exists, creating guest'
      );
    }
  }

  const userId = crypto.randomUUID();
  logger.info(
    { email: normalizedEmail, role: userRole, userId },
    'New user registration - temporary userId created for challenge'
  );

  return {
    serviceInput: {
      userDisplayName: defaultDisplayName,
      userName: normalizedEmail,
    },
    userId,
  };
};

const resolveSentropicRegistrationUser: AuthHonoResolveRegistrationUser = async ({
  email,
  userId: tempUserId,
  verificationToken,
}) => {
  const normalizedEmail = email.trim().toLowerCase();

  if (isInviteToken(verificationToken)) {
    // BR-39r L4 invite path (C3): evaluate the invite UNIFORMLY before the existing-user lookup, so
    // neither prepare nor resolve leaks account existence. Read-only validity check here (the
    // single-use consume happens atomically at beforePersist). An invalid invite collapses into the
    // generic `email_verification_required` — NO `invalid_invite` signal, identical to a cold register.
    if (!(await inviteMatchesEmail(verificationToken, normalizedEmail))) {
      logger.warn({ email: normalizedEmail }, 'Invite token invalid or not bound to this email');
      return emailVerificationRequired();
    }
  } else {
    const tokenValidation = await verifyValidationToken(verificationToken);
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

  const [existingUser] = await db
    .select({
      accountStatus: users.accountStatus,
      approvalDueAt: users.approvalDueAt,
      emailVerified: users.emailVerified,
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    if (existingUser.id !== tempUserId) {
      logger.warn(
        { tempUserId, userId: existingUser.id },
        'UserId mismatch between challenge and existing user'
      );
      return {
        error: {
          code: 'challenge_user_mismatch',
          message: "Le challenge ne correspond pas à l'utilisateur",
          status: 400,
        },
      };
    }

    if (!existingUser.emailVerified) {
      await db
        .update(users)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(users.id, existingUser.id));
    }

    await ensureWorkspaceForUser(existingUser.id);
    return { userId: existingUser.id };
  }

  // New user: create with appropriate role + account status, then proceed.
  let userRole: 'admin_app' | 'admin_org' | 'editor' | 'guest' = 'editor';
  if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin_app'))
      .limit(1);
    if (!admin) userRole = 'admin_app';
  }

  const accountStatus = userRole === 'admin_app' ? 'active' : 'pending_admin_approval';
  const approvalDueAt =
    userRole === 'admin_app' ? null : new Date(Date.now() + 48 * 60 * 60 * 1000);
  const defaultDisplayName = deriveDisplayNameFromEmail(normalizedEmail);

  await db.insert(users).values({
    accountStatus,
    approvalDueAt,
    createdAt: new Date(),
    displayName: defaultDisplayName,
    email: normalizedEmail,
    emailVerified: true,
    id: tempUserId,
    role: userRole,
    updatedAt: new Date(),
  });

  logger.info({ email: normalizedEmail, userId: tempUserId }, 'New user created with verified email');

  await ensureWorkspaceForUser(tempUserId);
  return { userId: tempUserId };
};

const finalizeSentropicRegistration: AuthHonoFinalizeRegistration = async (
  { credentialId, request, userId },
  c
) => {
  const [user] = await db
    .select({
      accountStatus: users.accountStatus,
      approvalDueAt: users.approvalDueAt,
      displayName: users.displayName,
      email: users.email,
      emailVerified: users.emailVerified,
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    logger.error({ userId }, 'User missing after registration');
    return c.json(
      { error: { code: 'user_not_found', message: 'User not found after registration.' } },
      500
    );
  }

  const otherDevices = await db
    .select({
      createdAt: webauthnCredentials.createdAt,
      deviceName: webauthnCredentials.deviceName,
      id: webauthnCredentials.id,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(desc(webauthnCredentials.createdAt));

  const isFirstDevice = otherDevices.length === 0;

  let effectiveRole: string = user.role;
  const accountStatus = user.accountStatus ?? null;
  const approvalDueAt = user.approvalDueAt ?? null;
  if (accountStatus === 'approval_expired_readonly') effectiveRole = 'guest';
  if (accountStatus === 'pending_admin_approval' && approvalDueAt && new Date() > approvalDueAt) {
    effectiveRole = 'guest';
  }

  const session = await createSession(userId, effectiveRole, {
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    name: request.deviceName,
    userAgent: c.req.header('user-agent'),
  });

  const isProduction = process.env.NODE_ENV === 'production';
  const origin = c.req.header('origin') || '';
  let domainAttr = '';
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      domainAttr = 'Domain=localhost';
    }
  } catch {
    // origin missing/malformed — skip Domain attribute
  }

  const cookieParts = [
    `session=${session.sessionToken}`,
    'HttpOnly',
    isProduction ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    domainAttr,
    `Max-Age=${7 * 24 * 60 * 60}`,
  ].filter(Boolean);
  c.header('Set-Cookie', cookieParts.join('; '));

  logger.info(
    {
      credentialId,
      emailVerified: true,
      isFirstDevice,
      role: user.role,
      userId,
    },
    'Registration successful'
  );

  return c.json({
    expiresAt: session.expiresAt.toISOString(),
    isFirstDevice,
    otherDevices:
      otherDevices.length > 0
        ? otherDevices.map((d) => ({
            createdAt: d.createdAt.toISOString(),
            deviceName: d.deviceName,
            id: d.id,
          }))
        : undefined,
    refreshToken: session.refreshToken,
    sessionToken: session.sessionToken,
    success: true,
    user: {
      displayName: user.displayName || null,
      email: user.email,
      id: user.id,
      role: user.role,
    },
  });
};

/**
 * BR-39r L4 — pre-persist invite consume. Returns a hook ONLY when the request carries an invite
 * token; the hook runs after WebAuthn verification, before the credential row is written, and
 * ATOMICALLY consumes the invite. If `consume` returns `null` (lost the concurrency race / already
 * consumed / expired) OR the bound email no longer matches, the hook THROWS — so NO credential is
 * created (no orphan), enforcing single-use. The throw surfaces as a generic registration failure
 * (C3: no `invalid_invite` signal).
 */
const resolveRegistrationBeforePersist = (
  input: { email: string; verificationToken: string },
): AuthHonoBeforePersistCredential | undefined => {
  if (!isInviteToken(input.verificationToken)) return undefined;
  const normalizedEmail = input.email.trim().toLowerCase();
  const tokenHash = hashInviteToken(input.verificationToken);
  return async ({ userId }) => {
    const consumed = await invites.consume(tokenHash, new Date(), userId);
    if (!consumed || consumed.email.trim().toLowerCase() !== normalizedEmail) {
      logger.warn({ email: normalizedEmail, userId }, 'Invite consume failed at persist (single-use / mismatch)');
      throw new Error('invite_consume_failed');
    }
    logger.info({ email: normalizedEmail, userId }, 'Invite token consumed at credential persist');
  };
};

const registerHandlers = createAuthWebAuthnRegistrationRouteHandlers({
  finalizeRegistration: finalizeSentropicRegistration,
  prepareRegistrationOptions: prepareSentropicRegistrationOptions,
  resolveBeforePersist: (input) =>
    resolveRegistrationBeforePersist({ email: input.email, verificationToken: input.verificationToken }),
  resolveRegistrationUser: resolveSentropicRegistrationUser,
  service: authHonoWebAuthnRegistrationService,
});

/**
 * POST /auth/register/options
 * Generate WebAuthn registration options.
 */
registerRouter.post('/options', registerHandlers.createPasskeyRegistrationOptions!);

/**
 * POST /auth/register/verify
 * Verify WebAuthn registration response + create session (via finalizeRegistration).
 */
registerRouter.post('/verify', registerHandlers.verifyPasskeyRegistration!);
