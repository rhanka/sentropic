import {
  createAuthWebAuthnRegistrationRouteHandlers,
  type AuthHonoFinalizeRegistration,
  type AuthHonoPrepareRegistrationOptions,
  type AuthHonoResolveRegistrationUser,
} from '@sentropic/auth-hono';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { users, webauthnCredentials } from '../../db/schema';
import { logger } from '../../logger';
import { authHonoWebAuthnRegistrationService } from '../../services/auth/webauthn-adapter';
import { verifyValidationToken } from '../../services/email-verification';
import { createSession } from '../../services/session-manager';
import { ensureWorkspaceForUser } from '../../services/workspace-service';
import { deriveDisplayNameFromEmail } from '../../utils/display-name';

/**
 * WebAuthn Registration Routes (`@sentropic/auth-hono`)
 *
 * POST /auth/register/options - Generate registration options
 * POST /auth/register/verify  - Verify registration response + create session
 */

export const registerRouter = new Hono();

const prepareSentropicRegistrationOptions: AuthHonoPrepareRegistrationOptions = async ({
  email,
  verificationToken,
}) => {
  const normalizedEmail = email.trim().toLowerCase();

  if (verificationToken) {
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
    logger.info({ email: normalizedEmail }, 'Verification token validated for registration');
  }

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

    if (!existingUser.emailVerified) {
      logger.warn({ email: normalizedEmail, userId }, 'Email not verified - registration blocked');
      return {
        error: {
          code: 'email_verification_required',
          message:
            'You must verify your email via magic link before registering a WebAuthn credential',
          status: 403,
        },
      };
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

  if (!verificationToken) {
    logger.warn({ email: normalizedEmail }, 'Email not verified - verification token required');
    return {
      error: {
        code: 'email_verification_required',
        message: "Vous devez vérifier votre email avec un code avant d'enregistrer un device",
        status: 403,
      },
    };
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

const registerHandlers = createAuthWebAuthnRegistrationRouteHandlers({
  finalizeRegistration: finalizeSentropicRegistration,
  prepareRegistrationOptions: prepareSentropicRegistrationOptions,
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
