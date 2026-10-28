import type { Pool } from 'pg';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { createHmacGrantSigner, type ContentGrantClaims } from '@sentropic/artifacts/content/grants';
import { createLifecycleService } from '@sentropic/artifacts/server/lifecycle';
import { createArtifactAuthorization } from '../../../api/src/services/artifacts/authorization';
import { createArtifactReaderActivation } from '../../../api/src/services/artifacts/reader-activation';
import { createContentHost, type ContentHostOptions } from './host';

/** Host composition only: existing PG schema/executor, read-only blob port, no DDL or publication. */
export function createContentRuntime(options: {
  pool: Pool; baseDomain: string; profileDigest: string; enabled(): boolean;
  signingSecret(): string | Uint8Array;
  blobs: ContentHostOptions['blobs'];
}) {
  const { pool } = options;
  const store = createPostgresArtifactStore(pool);
  const lifecycle = createLifecycleService(store);
  const activation = createArtifactReaderActivation(options);
  // Read current key material for every issue/verify, including after blob waits.
  const signer = () => {
    const secret = options.signingSecret();
    if (Buffer.byteLength(secret) < 32) throw new Error('Dedicated content signing key must contain at least 32 bytes');
    return createHmacGrantSigner({ secret });
  };
  async function scopeBinding(storageScopeId: string) {
    const { rows } = await pool.query<{ key: string }>(
      `SELECT kv.key FROM control.artifact_host_kv kv JOIN artifacts.storage_scopes s ON s.id=kv.value
       WHERE kv.storage_scope_id='app-artifact-scopes/v1' AND kv.value=$1`, [storageScopeId]);
    if (rows.length !== 1) return undefined;
    const value: unknown = JSON.parse(rows[0].key);
    if (!Array.isArray(value) || value.length !== 2 || value.some(part => typeof part !== 'string' || !part)) return undefined;
    return { tenantId: value[0] as string, workspaceId: value[1] as string };
  }
  async function current(claims: ContentGrantClaims) {
    const acl = await store.getArtifactAcl(claims.artifactId);
    if (!acl?.storageScopeId || !claims.releaseId) return false;
    const release = await store.getRelease(claims.releaseId);
    if (!release || release.artifactId !== claims.artifactId ||
      !['ready', 'retired'].includes(await store.getReleaseState(claims.releaseId))) return false;
    const bound = await scopeBinding(acl.storageScopeId);
    if (!bound) return false;
    const authority = createArtifactAuthorization({ pool, ...bound, storageScopeId: acl.storageScopeId,
      identity: { subject: claims.subjectId, tenantId: bound.tenantId, clientId: 'artifact-content-grant', credentialId: '' },
      // The host has verified this <=55s grant. Membership/account/tenant authority remains live.
      currentIdentity: async () => ({ readable: true, writable: false }) });
    return (await authority.current()).readable && lifecycle.canRead({ artifactId: claims.artifactId,
      state: await lifecycle.stateOf(claims.artifactId) }, acl, claims.subjectId, 'read');
  }
  return createContentHost({ ...options, current, acls: store, lifecycle,
    grants: { issue: input => signer().issue(input), verify: token => signer().verify(token) },
    publication: { getRelease: id => store.getRelease(id), async getCurrent(id) {
      const releaseId = await store.getCurrentReleaseId(id);
      return releaseId ? store.getRelease(releaseId) : undefined;
    } },
    async activate(input) {
      // Resolve the trusted issuing session from durable flow state, never headers/body claims.
      // W3.a independently rechecks namespace, session, nonce, profile, ACL and pointer in consume.
      const { rows } = await pool.query<{ namespace: string; payload: { subjectId: string; sessionId: string } }>(
        'SELECT namespace,payload FROM artifact_host.browser_flows WHERE flow_id=$1', [input.flowId]);
      if (rows.length !== 1) return undefined;
      const bound = await scopeBinding(rows[0].namespace);
      if (!bound) return undefined;
      return activation.consume({ ...bound, subjectId: rows[0].payload.subjectId, sessionId: rows[0].payload.sessionId }, input);
    },
  });
}
