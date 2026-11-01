import { createAuthWebAuthnAuthenticationRouteHandlers, type AuthHonoRouteHandlers } from '@sentropic/auth-hono';
import type { IdentityAuthHonoTransactionBindingV1 } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';
import { runCmAuthHttp } from './cm-http';

const handlersFor = (binding: IdentityAuthHonoTransactionBindingV1) =>
  createAuthWebAuthnAuthenticationRouteHandlers({
    service: binding.authentication,
    async resolveAuthenticationOptions({ email }) {
      if (!email) return { userId: undefined };
      const user = await binding.ports.users.findByEmail(binding.ports.accountPolicy.normalizeEmail(email));
      return { userId: user?.id };
    },
    async finalizeAuthentication({ request, userId, userVerified }, c) {
      const user = await binding.ports.users.findById(userId);
      if (!user) return c.json({ error: { code: 'user_not_found', message: 'User not found.' } }, 404);
      // The verified assertion, admission, counter/challenge and login write
      // all remain inside the same CM completion callback.
      const tokens = await binding.sessions.createSession({ user, mfaVerified: userVerified === true,
        deviceInfo: { name: request.deviceName, ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
          userAgent: c.req.header('user-agent') } });
      c.header('Set-Cookie', binding.ports.cookies.serializeSessionCookie({ token: tokens.sessionToken, expiresAt: tokens.expiresAt }));
      return c.json({ success: true, sessionToken: tokens.sessionToken, refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.toISOString(),
        user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
    },
  });

export const cmLoginHandlers: AuthHonoRouteHandlers = {
  createPasskeyAuthenticationOptions: c => runCmAuthHttp(c, null, binding =>
    new Hono().all('*', handlersFor(binding).createPasskeyAuthenticationOptions!)),
  verifyPasskeyAuthentication: c => runCmAuthHttp(c, 'authentication', binding =>
    new Hono().all('*', handlersFor(binding).verifyPasskeyAuthentication!)),
};
