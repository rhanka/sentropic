import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createFocusRouter,
  type CreateFocusRouterOptions,
  type FocusHttpPrincipal,
} from '@sentropic/focus/hono';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth, type AuthUser } from '../../middleware/auth';
import { isTenantAdmin } from '../../services/auth/tenant-membership';
import { failClosedDecisionValidator } from '../../services/focus/decision-validator';
import { createApiFocusLiveSession } from '../../services/focus/live-session';
import { productFocusTrackPort } from '../../services/focus/track-port';
import { resolveTenant } from '../../services/tenancy/resolve-tenant';
import { requireWorkspaceAccess } from '../../services/workspace-access';
import { applyFocusAuthorFence } from './focus-cutover';

const HTTP_RELAYER = Object.freeze({
  transport: 'http' as const,
  relayerId: 'sentropic-api',
  canonicalIdentity: Object.freeze({
    issuer: 'sentropic-api',
    subject: 'focus-owner-signature-route',
  }),
});

const ownerSubject = (principal: FocusHttpPrincipal): string => {
  const value = principal.email ?? principal.userId;
  return value.startsWith('human:') ? value : `human:${value}`;
};

export const createProductFocusRouterOptions = (): CreateFocusRouterOptions => ({
  resolvePrincipal(context) {
    const user = context.get('user') as AuthUser | undefined;
    if (!user?.workspaceId || !user.authenticatedAt) return undefined;
    return {
      userId: user.userId,
      sessionId: user.sessionId,
      authenticatedAt: user.authenticatedAt,
      workspaceId: user.workspaceId,
      email: user.email ?? null,
      role: user.role,
    };
  },
  decisionValidator: failClosedDecisionValidator,
  ownerSignature: {
    createSession({ principal, track, authorize }) {
      const owner = Object.freeze({
        principalId: principal.userId,
        canonicalIdentity: Object.freeze({
          issuer: 'sentropic-api-session',
          subject: ownerSubject(principal),
        }),
        authenticatedAt: principal.authenticatedAt,
      });
      return createApiFocusLiveSession({
        ownPrincipal: {
          authenticate: async (request) =>
            request.authentication.proof === principal.sessionId ? owner : undefined,
        },
        relayerProvenance: { getRelayerProvenance: async () => HTTP_RELAYER },
        authorizer: { authorize: ({ owner: candidate, target }) => authorize(candidate, target) },
      }, { trackPort: track });
    },
  },
  track: productFocusTrackPort,
  tenancy: {
    async authorize({ principal, owner, target }) {
      if (target.workspace !== principal.workspaceId) return false;
      if (owner && (
        owner.principalId !== principal.userId
        || owner.authenticatedAt !== principal.authenticatedAt
        || owner.canonicalIdentity.issuer !== 'sentropic-api-session'
        || owner.canonicalIdentity.subject !== ownerSubject(principal)
      )) return false;
      try {
        await requireWorkspaceAccess(principal.userId, target.workspace);
        const tenant = await resolveTenant({ workspaceId: target.workspace });
        if (!('tenantId' in tenant)) return false;
        return isTenantAdmin(principal.userId, tenant.tenantId, principal.role);
      } catch {
        return false;
      }
    },
  },
});

export interface CreateFocusNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly routerOptions?: CreateFocusRouterOptions;
}

export const createFocusNamespaceModule = (
  options: CreateFocusNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/focus',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    router.use('*', options.authenticate ?? requireAuth);
    applyFocusAuthorFence(router);
    router.route('/', createFocusRouter(options.routerOptions ?? createProductFocusRouterOptions()));
    return router;
  },
});

export const productFocusModule = createFocusNamespaceModule();
