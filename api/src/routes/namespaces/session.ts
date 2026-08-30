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

const AUTHOR = 'cluster-mesh-session-module';

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
  return createSessionNamespaceModule({
    handlers: sessionLifecycleHandlers,
    devices: sessionDeviceHandlers,
    projection,
    control: {
      runtime: control.runtime,
      store: control.store,
      targets: control.targets,
      author: createAuthorPort({ compositionRoot, namespace: '/session' }),
    },
  });
};

export const productSessionModule = createModule('product', {
  session: '/session', device: '/device', control: '/session/control',
});

export const createIdpSessionModule = (): ClusterMeshHonoNamespaceModule =>
  createModule('auth-idp', {
    session: '/session', device: '/device', control: '/session/control',
  });
