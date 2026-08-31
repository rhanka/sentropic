import {
  createAuthRouter,
  type AuthHonoRouteHandlers,
} from '@sentropic/auth-hono';
import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { getSentropicOAuthPorts } from '../auth/oauth';
import { applyAuthAuthorFence, type AuthCompositionRoot } from './auth-cutover';
import { accountRouter } from './auth/account';
import { loginHandlers } from './auth/authentication';
import { credentialHandlers } from './auth/credentials';
import { emailHandlers } from './auth/email';
import { createFederationRouter } from './auth/federation';
import { magicLinkHandlers } from './auth/magic-link';
import { registerHandlers } from './auth/registration';

export interface AuthPathProjection {
  readonly accountPath: string;
  readonly authPath: string;
  readonly oauthAuthorizePath: string;
}

export interface CreateAuthNamespaceModuleOptions {
  readonly compositionRoot: AuthCompositionRoot;
  readonly projection: AuthPathProjection;
}

const AUTH_RELATIVE_PATHS = [
  '/health',
  '/email/verify-request',
  '/email/verify-code',
  '/magic-link/request',
  '/magic-link/verify',
  '/register/options',
  '/register/verify',
  '/login/options',
  '/login/verify',
  '/credentials',
  '/credentials/:id',
  '/federation/:provider/start',
  '/federation/:provider/callback',
  '/federation/:provider/link/start',
  '/federation/:provider/link/callback',
  '/federation/challenge/complete',
] as const;

const identityHandlers: AuthHonoRouteHandlers = {
  ...emailHandlers,
  ...magicLinkHandlers,
  ...registerHandlers,
  ...loginHandlers,
  ...credentialHandlers,
};

const joinPath = (prefix: string, path: string): string =>
  `${prefix.replace(/\/$/, '')}${path}`;

export const createAuthNamespaceModule = (
  options: CreateAuthNamespaceModuleOptions,
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/auth',
  enabled: true,
  createRouter() {
    const router = new Hono();
    const { accountPath, authPath, oauthAuthorizePath } = options.projection;
    const authPaths = AUTH_RELATIVE_PATHS.map((path) => joinPath(authPath, path));
    const accountPaths = [accountPath, joinPath(accountPath, '/deactivate')];

    // Only enumerated identity routes are fenced. `/oauth` and `/session` are never prefix-caught.
    applyAuthAuthorFence(router, options.compositionRoot, [...authPaths, ...accountPaths]);
    for (const path of accountPaths) router.use(path, requireAuth);

    router.route('/', createAuthRouter({
      excludeRoutes: ['refreshSession', 'logout'],
      handlers: identityHandlers,
      ports: getSentropicOAuthPorts(),
      routePrefix: authPath,
      serviceName: 'sentropic-auth',
    }));
    router.route(joinPath(authPath, '/federation'), createFederationRouter(oauthAuthorizePath));
    router.route(accountPath, accountRouter);
    return router;
  },
});

const runtime = clusterMeshAdapter.sessionControl!.runtime;

export const productAuthPlugin = () => ({
  module: createAuthNamespaceModule({
    compositionRoot: 'product',
    projection: {
      accountPath: '/me',
      authPath: '/auth',
      oauthAuthorizePath: '/api/v1/oauth/authorize',
    },
  }),
  mount: '/' as const,
  runtime,
});

export const idpAuthPlugin = () => ({
  module: createAuthNamespaceModule({
    compositionRoot: 'auth-idp',
    projection: {
      accountPath: '/me',
      authPath: '',
      oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
    },
  }),
  mount: '/' as const,
  runtime,
});
