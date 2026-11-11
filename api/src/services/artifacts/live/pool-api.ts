import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { PoolManager } from './pool';
import { ARTIFACT_POOL_ADMIN_ENV } from './pool';
import type { KubernetesCore } from './pods';
import { hostGate, type HostBuildEnv, type HostIdentity } from './host-build-api';
import { refusal } from './host-live-body';

/** Pool occupancy and acceptance drain (§7.3.3, §7.6.3) on the existing builder mount, behind the same
 * hostGate S2S authentication (scope `artifacts:builder`). Bodies are closed; scopes come from the
 * authenticated host identity, never from request input (§10.3). */
export function createHostPoolApi(options: {
  /** Host identity of the verified service client; null refuses before the body is read. */
  authenticate(c: Context): HostIdentity | null;
  pool: PoolManager;
  /** Namespace-only client of the builder namespace; drain deletes through it, fenced by pod uid. */
  kubernetes: KubernetesCore;
  now(): number;
  /** `ARTIFACT_POOL_ADMIN=1` (preprod only by configuration): without it `POST /v1/pool/drain` refuses. */
  admin: boolean;
}) {
  const app = new Hono<HostBuildEnv>();
  app.use('*', hostGate(options.authenticate));
  const keyOf = (c: Context<HostBuildEnv>): string => c.get('identity').storageScopeId;
  const removePod = async (podName: string, podUid: string): Promise<void> => {
    await options.kubernetes.delete('services', podName, podUid).catch(() => undefined);
    await options.kubernetes.waitDeleted('services', podName, podUid).catch(() => undefined);
    await options.kubernetes.delete('pods', podName, podUid);
    await options.kubernetes.waitDeleted('pods', podName, podUid);
  };
  app.get('/v1/pool', async c => {
    try {
      const scope = keyOf(c);
      return c.json({ scope, occupancy: await options.pool.occupancy(scope), at: options.now() });
    } catch (error) { return refusal(c, error); }
  });
  app.post('/v1/pool/drain', bodyLimit({ maxSize: 4096,
    onError: c => c.json({ error: 'payload_too_large' }, 413) }),
  async c => {
    if (!options.admin) return c.json({ error: 'access_denied' }, 403);
    try {
      const scope = keyOf(c);
      const { before, at } = await options.pool.drain(scope, removePod);
      return c.json({ scope, before, at });
    } catch (error) { return refusal(c, error); }
  });
  return app;
}

export { ARTIFACT_POOL_ADMIN_ENV };
