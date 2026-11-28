import { createAuthMagicLinkRouteHandlers, type AuthHonoRouteHandlers, type AuthHonoSessionTokens } from '@sentropic/auth-hono';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  consumeMagicLinkContinuation,
  resolveMagicLinkContinuation,
  saveMagicLinkContinuation,
} from '../../../services/auth/magic-link-continuation';
import { sha256Hex } from '../../../services/identity/cm-proofs';
import { createSentropicOAuthStateCodec } from '../../auth/oauth';
import { runCmAuthHttp } from './cm-http';

const requestMagicLinkInputSchema = z.object({
  email: z.string().email(),
  continue: z.string().min(1).optional(),
  returnUrl: z.string().min(1).optional(),
});

export const createCmMagicLinkHandlers = (
  oauthAuthorizePath = '/api/v1/auth/oauth/authorize',
): AuthHonoRouteHandlers => ({
  requestMagicLink: c => runCmAuthHttp(c, 'magic_link_issue', (binding, tx) =>
    new Hono().all('*', async staged => {
      const rawBody = await staged.req.json().catch(() => null);
      const parsed = requestMagicLinkInputSchema.safeParse(rawBody);
      if (!parsed.success) {
        return staged.json({
          error: { code: 'invalid_input', details: parsed.error.issues, message: 'Invalid request data.' },
        }, 400);
      }

      const resolved = await resolveMagicLinkContinuation({
        continuation: parsed.data.continue,
        returnUrl: parsed.data.returnUrl,
        oauthAuthorizePath,
        stateCodec: createSentropicOAuthStateCodec(),
        findClient: clientId => binding.ports.oauthStateStore.findClient(clientId),
        now: binding.ports.clock.now(),
      });
      if (!resolved.ok) {
        return staged.json({ error: { code: resolved.code, message: resolved.message } }, 400);
      }

      const handler = createAuthMagicLinkRouteHandlers({ service: binding.magicLink }).requestMagicLink!;
      const forwardReq = new Request(staged.req.url, {
        method: staged.req.method,
        headers: new Headers(staged.req.raw.headers),
        body: JSON.stringify({ email: parsed.data.email }),
      });
      const response = await new Hono().all('*', handler).fetch(forwardReq);
      if (!response.ok || !resolved.continuationUrl) return response;

      const mail = binding.deferredMail.find(entry => entry.kind === 'magic_link');
      if (mail && mail.kind === 'magic_link') {
        const mailExpiresAt = new Date(mail.expiresAt);
        // Bound continuation TTL to the sealed OAuth state so resume never outlives it.
        const expiresAt =
          resolved.expiresAt && resolved.expiresAt.getTime() < mailExpiresAt.getTime()
            ? resolved.expiresAt
            : mailExpiresAt;
        await saveMagicLinkContinuation(tx.hostTransaction, {
          tokenHash: sha256Hex(mail.token),
          continuationUrl: resolved.continuationUrl,
          expiresAt,
        });
      }
      return response;
    })),

  verifyMagicLink: c => runCmAuthHttp(c, 'magic_link', (binding, tx) => new Hono().all('*', async staged => {
    let issued: AuthHonoSessionTokens | undefined;
    let requiresDeviceRegistration = false;
    let verifiedToken: string | undefined;
    const handlers = createAuthMagicLinkRouteHandlers({ service: {
      requestMagicLink: input => binding.magicLink.requestMagicLink(input),
      async verifyMagicLink(input) {
        const result = await binding.magicLink.verifyMagicLink(input);
        if (!result.valid) return result;
        verifiedToken = input.token;
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
    const consumed = verifiedToken
      ? await consumeMagicLinkContinuation(tx.hostTransaction, sha256Hex(verifiedToken), binding.ports.clock.now())
      : ({ status: 'missing' } as const);
    return staged.json({
      ...(await response.json() as Record<string, unknown>),
      sessionToken: issued.sessionToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt.toISOString(),
      ...(requiresDeviceRegistration ? { requiresDeviceRegistration: true } : {}),
      ...(consumed.status === 'ok' ? { continueUrl: consumed.continuationUrl } : {}),
      ...(consumed.status === 'expired' ? { continuationExpired: true } : {}),
    });
  })),
});

export const cmMagicLinkHandlers: AuthHonoRouteHandlers = createCmMagicLinkHandlers();
