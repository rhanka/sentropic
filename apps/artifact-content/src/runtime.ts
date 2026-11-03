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
      `SELECT kv.key FROM control.artifact_host_kv kv JOIN artifacts.storage_scopes s
       ON s.id=kv.value AND s.org_id=(kv.key::jsonb->>0)
       WHERE kv.storage_scope_id='app-artifact-scopes/v1' AND kv.value=$1`, [storageScopeId]);
    if (rows.length !== 1) return undefined;
    const value: unknown = JSON.parse(rows[0].key);
    if (!Array.isArray(value) || value.length !== 2 || value.some(part => typeof part !== 'string' || !part)) return undefined;
    return { tenantId: value[0] as string, workspaceId: value[1] as string };
  }
  // G1 owner Q2: live account approval, re-checked on every content read (fail-closed).
  async function isApprovedAccount(principalId: string) {
    const { rows } = await pool.query<{ approved: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM users u
         JOIN tenant_memberships tm ON tm.user_id = u.id
         JOIN tenants t ON t.id = tm.tenant_id
         WHERE u.id = $1 AND u.account_status = 'active' AND u.disabled_at IS NULL
           AND t.status = 'active' AND tm.status = 'approved') AS approved`,
      [principalId]);
    return rows[0]?.approved === true;
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
    const current = await authority.current();
    // G1: read grants require the live approval the authority read just verified.
    return current.readable && lifecycle.canRead({ artifactId: claims.artifactId,
      state: await lifecycle.stateOf(claims.artifactId) }, acl, claims.subjectId, 'read', () => current.readable);
  }
  return createContentHost({ ...options, current, isApprovedAccount, acls: store, lifecycle,
    grants: { issue: input => signer().issue(input), verify: token => signer().verify(token) },
    publication: { getRelease: id => store.getRelease(id), async getCurrent(id) {
      const releaseId = await store.getCurrentReleaseId(id);
      return releaseId ? store.getRelease(releaseId) : undefined;
    } },
    activate: input => activation.consumeForContentOrigin(input),
  });
}
