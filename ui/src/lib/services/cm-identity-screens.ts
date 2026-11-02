import type { IdentityAuthScreenPorts } from '@sentropic/cluster-mesh/ui/auth-flow';
import type { IdentityManagementScreenPorts, IdentityScreenText } from '@sentropic/cluster-mesh/ui/management-ports';
import { createIdentityManagementTransport } from '@sentropic/cluster-mesh/ui/management';
import { setUser, type User } from '$lib/stores/session';
import { addToast } from '$lib/stores/toast';
import { loadUserWorkspaces } from '$lib/stores/workspaceScope';
import { apiFetch } from '$lib/utils/api';
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

const managementTransport = createIdentityManagementTransport(apiFetch);
export const createSentropicIdentityManagementPorts = (user: User | null | undefined, text: IdentityScreenText,
  confirm: IdentityManagementScreenPorts['confirm']): IdentityManagementScreenPorts => ({
  userId: user?.id ?? null, role: user?.role ?? null, text, confirm, transport: managementTransport,
  notify: addToast, operationId: () => crypto.randomUUID(), refreshWorkspaceScope: loadUserWorkspaces,
});
