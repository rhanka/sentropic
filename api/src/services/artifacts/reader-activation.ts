import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { parseContentHost } from '@sentropic/artifacts/content/routing';
import { createLifecycleService } from '@sentropic/artifacts/server/lifecycle';
import type { BrowserFlowBinding } from '@sentropic/artifacts/adapters/postgres-activation';
import { createArtifactHostActivationStorage } from './activation-storage';
import { artifactReadClient, createArtifactAuthorization } from './authorization';
import { ARTIFACT_SESSION_CLIENT, createArtifactCredentialReader } from './credentials';

/** Host-verified current app session only; never deserialize these fields from a reader body. */
export interface ArtifactReaderSession {
  subjectId: string;
  sessionId: string;
  tenantId: string;
  workspaceId: string;
}
export interface ArtifactReaderTarget {
  artifactId: string;
  releaseId: string;
  channel: 'stable' | 'pinned';
  targetOrigin: string;
  nonce: string;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = () => new Error('Artifact reader activation refused');
function nonceDigest(nonce: string) {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(nonce)) throw denied();
  return digest(nonce);
}
function approvedOrigin(baseDomain: string, target: Omit<ArtifactReaderTarget, 'nonce'>) {
  try {
    const url = new URL(target.targetOrigin);
    if (url.protocol !== 'https:' || url.origin !== target.targetOrigin || url.port) return false;
    const parsed = parseContentHost(url.host, baseDomain);
    return parsed?.kind === target.channel && (parsed.kind === 'stable'
      ? parsed.artifactId === target.artifactId : parsed.releaseId === target.releaseId);
  } catch { return false; }
}
async function namespaceFor(client: Pool | PoolClient, session: ArtifactReaderSession, lock = false) {
  const { rows } = await client.query<{ value: string }>(
    `SELECT kv.value FROM control.artifact_host_kv kv
     JOIN artifacts.storage_scopes s ON s.id=kv.value AND s.org_id=$2
     WHERE kv.storage_scope_id='app-artifact-scopes/v1' AND kv.key=$1 ${lock ? 'FOR SHARE OF kv, s' : ''}`,
    [JSON.stringify([session.tenantId, session.workspaceId]), session.tenantId]);
  return rows[0]?.value;
}

/** All authority locks remain on the package consume client through COMMIT. */
async function currentPolicy(client: PoolClient, pool: Pool, namespace: string,
  session: ArtifactReaderSession, target: Omit<ArtifactReaderTarget, 'nonce'>, baseDomain: string) {
  if (!approvedOrigin(baseDomain, target) || await namespaceFor(client, session, true) !== namespace) return undefined;
  const artifact = await client.query<{ revision: string }>(
    'SELECT xmin::text AS revision FROM artifacts.artifacts WHERE id=$1 AND storage_scope_id=$2 FOR SHARE',
    [target.artifactId, namespace]);
  if (artifact.rowCount !== 1) return undefined;
  const release = await client.query(
    `SELECT id FROM artifacts.releases WHERE id=$1 AND artifact_id=$2 AND state IN ('ready','retired') FOR SHARE`,
    [target.releaseId, target.artifactId]);
  if (release.rowCount !== 1) return undefined;
  if (target.channel === 'stable') {
    const current = await client.query<{ release_id: string }>(
      'SELECT release_id FROM artifacts.artifact_current WHERE artifact_id=$1 FOR SHARE', [target.artifactId]);
    if (current.rows[0]?.release_id !== target.releaseId) return undefined;
  }
  // Lock an existing grant against deletion; absent grants cannot authorize this reader.
  const grants = await client.query<{ revision: string }>(
    'SELECT xmin::text AS revision FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2 FOR SHARE',
    [target.artifactId, session.subjectId]);
  const store = createPostgresArtifactStore(client as unknown as Pool);
  const acl = await store.getArtifactAcl(target.artifactId);
  const lifecycle = createLifecycleService(store);
  if (!acl || !lifecycle.canRead({ artifactId: target.artifactId, state: await lifecycle.stateOf(target.artifactId) },
    acl, session.subjectId, 'read', () => true)) return undefined;
  // Session expiry is evaluated last, after every object/pointer/ACL/membership wait.
  const authority = createArtifactAuthorization({ pool, workspaceId: session.workspaceId, storageScopeId: namespace,
    identity: { subject: session.subjectId, tenantId: session.tenantId, clientId: ARTIFACT_SESSION_CLIENT,
      credentialId: session.sessionId }, currentIdentity: createArtifactCredentialReader({ kind: 'session', resource: '' }) });
  const current = await authority.currentOn(artifactReadClient(client));
  return current.readable ? digest(JSON.stringify([current.revision, artifact.rows[0].revision, grants.rows])) : undefined;
}
