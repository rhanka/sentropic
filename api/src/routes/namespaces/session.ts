import {
  activateSessionCutover,
  createSessionNamespaceModule,
  type ClusterMeshHonoNamespaceModule,
  type NamespaceCutoverKey,
  type SessionPathProjection,
} from '@sentropic/cluster-mesh';
import { clusterMeshAdapter } from '../../services/cluster-mesh-adapter';
import { sessionDeviceHandlers } from './session-device';
import { sessionLifecycleHandlers } from './session-lifecycle';
import { createSessionContentRouter } from './session-content';

const AUTHOR = 'cluster-mesh-session-module';

export const SESSION_PATHS = [
  '/session',
  '/session/refresh',
  '/session/extension-token',
  '/session/all',
  '/session/list',
  '/device/code',
  '/device/poll',
  '/device/approve',
  '/session/control/drive',
  '/session/control/wake',
  '/session/control/relaunch',
  '/session/content',
] as const;

const createAuthorPort = (key: NamespaceCutoverKey) => {
  const control = clusterMeshAdapter.sessionControl;
  if (!control) throw new Error('cluster mesh session control is not configured');
  let activation: Promise<unknown> | undefined;
  return {
    async ensureAuthor() {
      try {
        let record = await control.cutovers.find(key);
        if (!record || record.status === 'shadow') {
          activation ??= activateSessionCutover({
            store: control.cutovers,
            key,
            generationId: control.runtime.generation.generationId,
            previousGenerationId: `legacy-auth-session-${key.compositionRoot}`,
            author: AUTHOR,
            strategy: 'parity-suite',
            suiteRefs: [
              'api/tests/api/auth/session.test.ts',
              'api/tests/api/auth-device-code.spec.ts',
              'api/tests/unit/device-route.test.ts',
            ],
            intentValidationRef: 'packages/cluster-mesh/tests/session-router.spec.ts',
          }).finally(() => { activation = undefined; });
          await activation;
          record = await control.cutovers.find(key);
        }
        const ok = record?.status === 'active'
          && record.activeAuthor === AUTHOR
          && record.selectedGenerationId === control.runtime.generation.generationId;
        return ok ? { ok: true } : { ok: false, reason: 'wrong_author' as const };
      } catch {
        return { ok: false, reason: 'cutover_unavailable' as const };
      }
    },
  };
};

const createModule = (
  compositionRoot: NamespaceCutoverKey['compositionRoot'],
  projection: SessionPathProjection,
): ClusterMeshHonoNamespaceModule => {
  const control = clusterMeshAdapter.sessionControl;
  if (!control) throw new Error('cluster mesh session control is not configured');
  const module = createSessionNamespaceModule({
    handlers: sessionLifecycleHandlers,
    devices: sessionDeviceHandlers,
    projection,
    control: {
      runtime: control.runtime,
      store: control.store,
      targets: control.targets,
      instructions: {
        // BR-CUS-EX1 source gap: control stays fail-closed until a production resolver exists.
        resolve: async () => null,
      },
      author: createAuthorPort({ compositionRoot, namespace: '/session' }),
    },
  });
  if (compositionRoot !== 'product') return { ...module, createRouter(ports) {
    const router = module.createRouter(ports);
    // Refuse before the IdP screen fallback; no content handler or capability is installed.
    for (const path of ['/session/content', '/session/content/*']) {
      router.all(path, (c) => c.json({ error: 'not_found' }, 404));
    }
    return router;
  } };
  return { ...module, createRouter(ports) {
    const router = module.createRouter(ports);
    const author = createAuthorPort({ compositionRoot, namespace: '/session' });
    for (const path of ['/session/content', '/session/content/*']) router.use(path, async (c, next) => {
      const result = await author.ensureAuthor();
      if (!result.ok) return c.json({ error: result.reason }, 503);
      return next();
    });
    return router.route('/session/content', createSessionContentRouter());
  } };
};

export const productSessionModule = createModule('product', {
  session: '/session', device: '/device', control: '/session/control',
});

export const createIdpSessionModule = (): ClusterMeshHonoNamespaceModule =>
  createModule('auth-idp', {
    session: '/session', device: '/device', control: '/session/control',
  });
