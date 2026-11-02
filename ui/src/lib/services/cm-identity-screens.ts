import type { IdentityAuthScreenPorts } from '@sentropic/cluster-mesh/ui/auth-flow';
import { setUser } from '$lib/stores/session';
import { createSentropicAuthTransport, resolveAuthUiLabels, toSentropicUser } from './auth-transport';

/** Root projection: host storage/navigation only; the shared module owns flow decisions. */
export function createSentropicIdentityScreenPorts(locale: string | null | undefined, params: URLSearchParams,
  navigation: Pick<IdentityAuthScreenPorts, 'navigate' | 'resumeOAuth'>): IdentityAuthScreenPorts {
  return {
    transport: createSentropicAuthTransport(), labels: resolveAuthUiLabels(locale),
    presentation: { email: params.get('login_hint') ?? undefined,
      verificationToken: params.get('sentropic_invite_token') ?? undefined,
      oauthContinuation: params.get('continue') ?? undefined, returnPath: params.get('returnUrl') ?? undefined },
    loginHref: '/auth/login', registerHref: '/auth/register', ...navigation,
    commitSession(session) {
      setUser(toSentropicUser(session.user));
      if (session.sessionToken) sessionStorage.setItem('sessionToken', session.sessionToken);
      if (session.refreshToken) sessionStorage.setItem('refreshToken', session.refreshToken);
    },
  };
}
