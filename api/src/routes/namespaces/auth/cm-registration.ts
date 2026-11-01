import { createAuthWebAuthnRegistrationRouteHandlers, type AuthHonoRouteHandlers } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1, type IdentityAuthHonoTransactionBindingV1 } from '@sentropic/cluster-mesh';
import { Hono, type Context } from 'hono';
import type { CmIdentityTransaction } from '../../../services/identity/cm-transaction';
import { provisionCmAuthWorkspace } from '../../../services/identity/cm-auth-workspace';
import { refuseCmRegistration, runCmAuthHttp } from './cm-http';

const required = () => ({ error: { code: 'email_verification_required',
  message: 'Verify your email before registering a device.', status: 403 as const } });

function handlersFor(binding: IdentityAuthHonoTransactionBindingV1, tx: CmIdentityTransaction) {
  const ports = binding.ports;
  const proven = async (email: string, token: string | undefined): Promise<boolean> => {
    if (!token) return false;
    if (token.startsWith('sit_')) {
      if (!ports.invites) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
      const invite = await ports.invites.findValid(await ports.tokens.hashSecret(token), ports.clock.now());
      return invite?.email === email;
    }
    return ports.emailVerification.verifyToken(email, token, ports.clock.now());
  };
  return createAuthWebAuthnRegistrationRouteHandlers({
    service: binding.registration,
    async prepareRegistrationOptions(input) {
      const email = ports.accountPolicy.normalizeEmail(input.email);
      const proof = await proven(email, input.verificationToken);
      const existing = await ports.users.findByEmail(email);
      if ((!existing || !existing.emailVerified || input.verificationToken) && !proof) return required();
      return { userId: existing?.id ?? ports.random.uuid(), serviceInput: {
        userName: email, userDisplayName: existing?.displayName ?? ports.accountPolicy.deriveDisplayName(email),
        ...(existing ? { userId: existing.id } : {}),
      } };
    },
    async resolveRegistrationUser(input) {
      const email = ports.accountPolicy.normalizeEmail(input.email);
      if (!(await proven(email, input.verificationToken))) return required();
      let user = await ports.users.findByEmail(email);
      if (user && user.id !== input.userId) return { error: { code: 'challenge_user_mismatch',
        message: 'Registration challenge does not belong to this user.', status: 400 as const } };
      if (user) {
        if (!user.emailVerified) user = await ports.users.update(user.id, { emailVerified: true });
      } else {
        const isFirstUser = (await ports.users.count()) === 0;
        const role = await ports.accountPolicy.roleForNewUser({ email, isFirstUser });
        const status = await ports.accountPolicy.statusForNewUser({ email, isFirstUser, now: ports.clock.now() });
        user = await ports.users.create({ email, role, emailVerified: true,
          displayName: ports.accountPolicy.deriveDisplayName(email), ...status });
      }
      if (!user) return refuseCmRegistration();
      await provisionCmAuthWorkspace(user.id, tx);
      return { userId: user.id };
    },
    resolveBeforePersist(input) {
      return async ({ userId }) => {
        await tx.lockSubject(userId);
        const email = ports.accountPolicy.normalizeEmail(input.email);
        const hash = await ports.tokens.hashSecret(input.verificationToken);
        if (input.verificationToken.startsWith('sit_')) {
          if (!ports.invites) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
          const consumed = await ports.invites.consume(hash, ports.clock.now(), userId);
          if (!consumed || consumed.email !== email) return refuseCmRegistration();
        } else {
          const ticket = await tx.custody.emailTickets.findByTokenHash(hash);
          if (!ticket || ticket.email !== email) return refuseCmRegistration();
          try {
            await tx.custody.emailTickets.consume({ tokenHash: hash, email, expectedRevision: ticket.revision,
              bindUserId: userId, at: ports.clock.now().toISOString() });
          } catch (error) {
            if (error instanceof IdentityCustodyErrorV1 && ['proof_state_conflict', 'proof_binding_mismatch'].includes(error.code)) {
              return refuseCmRegistration();
            }
            throw error;
          }
        }
      };
    },
    async finalizeRegistration({ userId, credentialId, request }, c) {
      const user = await ports.users.findById(userId);
      if (!user) return refuseCmRegistration();
      const otherDevices = (await ports.credentials.listForUser(userId))
        .filter(row => !row.revokedAt && row.credentialId !== credentialId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map(row => ({ id: row.id, deviceName: row.name, createdAt: row.createdAt }));
      const tokens = await binding.sessions.createSession({ user, mfaVerified: false, deviceInfo: {
        name: request.deviceName, ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'), userAgent: c.req.header('user-agent'),
      } });
      c.header('Set-Cookie', ports.cookies.serializeSessionCookie({ token: tokens.sessionToken, expiresAt: tokens.expiresAt }));
      return c.json({ success: true, sessionToken: tokens.sessionToken, refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.toISOString(), isFirstDevice: otherDevices.length === 0,
        ...(otherDevices.length ? { otherDevices } : {}),
        user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
    },
  });
}

async function dispatch(c: Context, optionsOnly: boolean): Promise<Response> {
  const input = await c.req.raw.clone().json().catch(() => null);
  const presentation = input && typeof input.email === 'string' &&
    (input.verificationToken === undefined || typeof input.verificationToken === 'string')
    ? { email: input.email, verificationToken: input.verificationToken } : undefined;
  return runCmAuthHttp(c, optionsOnly ? null : 'registration', (binding, tx) => {
    const handlers = handlersFor(binding, tx);
    return new Hono().all('*', optionsOnly ? handlers.createPasskeyRegistrationOptions! : handlers.verifyPasskeyRegistration!);
  }, presentation);
}
export const cmRegisterHandlers: AuthHonoRouteHandlers = {
  createPasskeyRegistrationOptions: c => dispatch(c, true), verifyPasskeyRegistration: c => dispatch(c, false),
};
