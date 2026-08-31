import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { createServiceS2sRouter } from '../auth/service-s2s';
import {
  createSentropicOAuthIngress,
  createSentropicWellKnownIngress,
} from './oauth-ingress';

export type OAuthCompositionRoot = 'product' | 'auth-idp';

export interface CreateOAuthNamespaceModuleOptions {
  readonly compositionRoot: OAuthCompositionRoot;
  readonly publicPath: string;
}

const AUTHOR = 'auth-hono-oauth-module';
const control = clusterMeshAdapter.sessionControl;
if (!control) throw new Error('cluster mesh OAuth cutover control is not configured');
const activations = new Map<OAuthCompositionRoot, Promise<void>>();

const ensureAuthor = async (compositionRoot: OAuthCompositionRoot): Promise<boolean> => {
  const key = { compositionRoot, namespace: '/oauth' as const };
  let record = await control.cutovers.find(key);
  if (!record || record.status === 'shadow') {
    let activation = activations.get(compositionRoot);
    if (!activation) {
      activation = (async () => {
        const previousGenerationId = compositionRoot === 'product'
          ? 'legacy-product-oauth-v1'
          : 'legacy-auth-idp-oauth-v1';
        const shadow = {
          ...key,
          selectedGenerationId: control.runtime.generation.generationId,
          previousGenerationId,
          activeAuthor: AUTHOR,
          status: 'shadow' as const,
          shadowComparison: {
            strategy: 'pre-deletion-shadow-suite',
            metadataReadRef: 'api/tests/api/cluster-mesh-oauth-roots.test.ts',
            tokenValidationIntentRef: 'packages/auth-hono/tests/oauth-token.test.ts',
            effectsDuplicated: false,
          },
          rollbackCheckpoint: { generationId: previousGenerationId, activeAuthor: 'legacy-auth-router' },
        };
        await control.cutovers.activate(shadow);
        await control.cutovers.activate({
          ...shadow,
          status: 'active',
          activatedAt: new Date().toISOString(),
        });
      })().finally(() => activations.delete(compositionRoot));
      activations.set(compositionRoot, activation);
    }
    await activation;
    record = await control.cutovers.find(key);
  }
  return record?.status === 'active'
    && record.activeAuthor === AUTHOR
    && record.selectedGenerationId === control.runtime.generation.generationId;
};

const applyAuthorFence = (router: Hono, compositionRoot: OAuthCompositionRoot): void => {
  router.use('*', async (c, next) => {
    try {
      if (!await ensureAuthor(compositionRoot)) return c.json({ error: 'wrong_author' }, 503);
      await next();
    } catch {
      return c.json({ error: 'oauth_control_unavailable' }, 503);
    }
  });
};

export const createOAuthNamespaceModule = (
  options: CreateOAuthNamespaceModuleOptions,
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/oauth',
  enabled: true,
  createRouter() {
    const router = new Hono();
    applyAuthorFence(router, options.compositionRoot);
    router.route('/', createSentropicOAuthIngress(options.publicPath));
    router.route('/s2s', createServiceS2sRouter({
      oauthPublicPath: options.publicPath,
      servicePublicPath: `${options.publicPath}/s2s`,
    }));
    return router;
  },
});

export const createOAuthWellKnownProjection = (
  options: CreateOAuthNamespaceModuleOptions,
): Hono => {
  const router = new Hono();
  applyAuthorFence(router, options.compositionRoot);
  router.route('/', createSentropicWellKnownIngress(options.publicPath));
  return router;
};
