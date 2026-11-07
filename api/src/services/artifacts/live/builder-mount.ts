import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { HostBuildEnv, HostIdentity } from './host-build-api';

/** S2S scope a content host needs to call the builder (s-archi W7 builder mount, 07/11). */
export const ARTIFACT_BUILDER_SCOPE = 'artifacts:builder';
/** Public mount: POST <base>/v1/builds and GET <base>/v1/builds/:artifactId/:jobId. The ui nginx keeps it out of its logs. */
export const ARTIFACT_BUILDER_BASE_PATH = '/api/v1/artifacts/builder';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BINDINGS = 16;
const FIELDS = 'clientId,hostId,storageScopeId';

/** `ARTIFACT_BUILDER_HOST_BINDINGS_JSON` = [{clientId, hostId, storageScopeId}], owned by sentropic. Several clients may
 * bind one host (credential rotation); one scope never belongs to two hosts. Absent, invalid or any malformed entry
 * binds nothing: default deny. */
export function parseBuilderHostBindings(raw: string | undefined): ReadonlyMap<string, HostIdentity> {
  const none = new Map<string, HostIdentity>();
  let entries: unknown;
  try { entries = JSON.parse(raw ?? ''); } catch { return none; }
  if (!Array.isArray(entries) || entries.length > MAX_BINDINGS) return none;
  const bindings = new Map<string, HostIdentity>(); const owners = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Object.keys(entry).sort().join() !== FIELDS) return none;
    const { clientId, hostId, storageScopeId } = entry as Record<string, unknown>;
    if (typeof clientId !== 'string' || !clientId || clientId.length > 256 || bindings.has(clientId)
      || typeof hostId !== 'string' || !ID.test(hostId) || typeof storageScopeId !== 'string' || !ID.test(storageScopeId)
      || (owners.get(storageScopeId) ?? hostId) !== hostId) return none;
    bindings.set(clientId, Object.freeze({ hostId, storageScopeId })); owners.set(storageScopeId, hostId);
  }
  return bindings;
}

/** Host identity of the service client `createRequireServiceAuth` verified and set as `serviceClient`: the token must
 * carry the builder scope and its client must be bound. Any other client resolves to null. */
export const hostAuthenticator = (bindings: ReadonlyMap<string, HostIdentity>) => (c: Context): HostIdentity | null => {
  const client = (c.get as (key: string) => unknown)('serviceClient') as { clientId?: unknown; scopes?: unknown } | undefined;
  if (typeof client?.clientId !== 'string' || !Array.isArray(client.scopes) || !client.scopes.includes(ARTIFACT_BUILDER_SCOPE)) return null;
  return bindings.get(client.clientId) ?? null;
};

/** The host build API behind the S2S guard (`requireService` = createRequireServiceAuth with ARTIFACT_BUILDER_SCOPE).
 * Until the builder service is composed (`api` null, GB4-P), a bound host gets builder_unavailable. */
export function createBuilderMount(options: {
  requireService: MiddlewareHandler; authenticate(c: Context): HostIdentity | null; api: Hono<HostBuildEnv> | null;
}) {
  const app = new Hono();
  app.use(`${ARTIFACT_BUILDER_BASE_PATH}/*`, options.requireService);
  if (options.api) app.route(ARTIFACT_BUILDER_BASE_PATH, options.api);
  else app.all(`${ARTIFACT_BUILDER_BASE_PATH}/*`, c => options.authenticate(c)
    ? c.json({ error: 'builder_unavailable' }, 503) : c.json({ error: 'host_not_bound' }, 403));
  return app;
}
