import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';

export interface TrackProviderDescriptor {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly readContractMajor: number;
  readonly packageDigest: string;
}

export const PINNED_TRACK_PROVIDER = Object.freeze({
  packageName: '@sentropic/track',
  packageVersion: '0.91.1',
  readContractMajor: 1,
  packageDigest: 'sha512-KGFWqlUSNdT+SERGQmlpFglTZM0ypSyRNosgVyHCTrlCrqpVXr6tYGWKZmNHjSPWMhqtVdHWWXplSnQscj+ArQ==',
}) satisfies TrackProviderDescriptor;

export interface TrackReadProjection {
  readonly reference: string;
  readonly digest: string;
}

export interface ExternalTrackReadPort {
  readonly descriptor: TrackProviderDescriptor;
  readEvidence(input: {
    readonly workspace: string;
    readonly decisionId: string;
  }): Promise<TrackReadProjection>;
  readCursor(input: { readonly workspace: string }): Promise<TrackReadProjection>;
}

export const isTrackProviderCompatible = (
  descriptor: TrackProviderDescriptor,
  expected: TrackProviderDescriptor = PINNED_TRACK_PROVIDER,
): boolean => descriptor.packageName === expected.packageName
  && descriptor.packageVersion === expected.packageVersion
  && descriptor.readContractMajor === expected.readContractMajor
  && descriptor.packageDigest === expected.packageDigest;

export const TRACK_READ_PATHS = [
  '/evidence/:workspace/:decisionId',
  '/cursor/:workspace',
] as const;

export interface CreateTrackNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly provider?: ExternalTrackReadPort;
  readonly expectedProvider?: TrackProviderDescriptor;
}

export const createTrackNamespaceModule = (
  options: CreateTrackNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/track',
  enabled: options.enabled ?? false,
  createRouter() {
    const router = new Hono();
    const compatible = options.provider !== undefined
      && isTrackProviderCompatible(options.provider.descriptor, options.expectedProvider);
    const unavailable: MiddlewareHandler = async (context, next) => {
      if (!options.provider) return context.json({ error: 'track_provider_unavailable' }, 503);
      if (!compatible) return context.json({ error: 'track_provider_incompatible' }, 503);
      return next();
    };
    for (const path of TRACK_READ_PATHS) {
      router.use(path, unavailable);
      router.use(path, options.authenticate ?? requireAuth);
    }

    router.get('/evidence/:workspace/:decisionId', async (context) => {
      try {
        const item = await options.provider!.readEvidence({
          workspace: context.req.param('workspace'),
          decisionId: context.req.param('decisionId'),
        });
        return context.json({ item });
      } catch {
        return context.json({ error: 'track_provider_unavailable' }, 503);
      }
    });
    router.get('/cursor/:workspace', async (context) => {
      try {
        const item = await options.provider!.readCursor({
          workspace: context.req.param('workspace'),
        });
        return context.json({ item });
      } catch {
        return context.json({ error: 'track_provider_unavailable' }, 503);
      }
    });
    return router;
  },
});

// The route shell exposes a truthful 503; no Track provider or write authority is activated.
export const productTrackModule = createTrackNamespaceModule({ enabled: true });
