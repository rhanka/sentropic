import { createAuthMagicLinkRouteHandlers, type AuthHonoRouteHandlers, type AuthHonoSessionTokens } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { runCmAuthHttp } from './cm-http';

export const cmMagicLinkHandlers: AuthHonoRouteHandlers = {
  requestMagicLink: c => runCmAuthHttp(c, 'magic_link_issue', binding =>
    new Hono().all('*', createAuthMagicLinkRouteHandlers({ service: binding.magicLink }).requestMagicLink!)),
  verifyMagicLink: c => runCmAuthHttp(c, 'magic_link', binding => new Hono().all('*', async staged => {
    let issued: AuthHonoSessionTokens | undefined;
    let requiresDeviceRegistration = false;
    const handlers = createAuthMagicLinkRouteHandlers({ service: {
      requestMagicLink: input => binding.magicLink.requestMagicLink(input),
      async verifyMagicLink(input) {
        const result = await binding.magicLink.verifyMagicLink(input);
        if (!result.valid) return result;
        const credentials = await binding.ports.credentials.listForUser(result.user.id);
        requiresDeviceRegistration = !credentials.some(credential => credential.revokedAt === null);
        issued = await binding.sessions.createSession({ user: result.user, mfaVerified: false,
          deviceInfo: { name: requiresDeviceRegistration ? 'Magic Link - Device Registration' : 'Magic Link - Device Activation',
            ipAddress: staged.req.header('x-forwarded-for') || staged.req.header('x-real-ip'),
            userAgent: staged.req.header('user-agent') } });
        staged.header('Set-Cookie', binding.ports.cookies.serializeSessionCookie({ token: issued.sessionToken, expiresAt: issued.expiresAt }));
        return result;
      },
    } });
    const response = await handlers.verifyMagicLink!(staged);
    if (!issued) return response;
    return staged.json({ ...await response.json(), sessionToken: issued.sessionToken, refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt.toISOString(), ...(requiresDeviceRegistration ? { requiresDeviceRegistration: true } : {}) });
  })),
};
