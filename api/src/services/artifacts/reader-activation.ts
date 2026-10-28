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
  let pointerRevision = 'pinned';
  if (target.channel === 'stable') {
    const current = await client.query<{ release_id: string; revision: string }>(
      'SELECT release_id, xmin::text AS revision FROM artifacts.artifact_current WHERE artifact_id=$1 FOR SHARE', [target.artifactId]);
    if (current.rows[0]?.release_id !== target.releaseId) return undefined;
    pointerRevision = current.rows[0].revision;
  }
  // Lock an existing grant against deletion; absent grants cannot authorize this reader.
  const grants = await client.query<{ revision: string }>(
    'SELECT xmin::text AS revision FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2 FOR SHARE',
    [target.artifactId, session.subjectId]);
  const store = createPostgresArtifactStore(client as unknown as Pool);
  const acl = await store.getArtifactAcl(target.artifactId);
  const lifecycle = createLifecycleService(store);
  if (!acl || !lifecycle.canRead({ artifactId: target.artifactId, state: await lifecycle.stateOf(target.artifactId) },
    acl, session.subjectId, 'read')) return undefined;
  // Session expiry is evaluated last, after every object/pointer/ACL/membership wait.
  const authority = createArtifactAuthorization({ pool, workspaceId: session.workspaceId, storageScopeId: namespace,
    identity: { subject: session.subjectId, tenantId: session.tenantId, clientId: ARTIFACT_SESSION_CLIENT,
      credentialId: session.sessionId }, currentIdentity: createArtifactCredentialReader({ kind: 'session', resource: '', jkt: null }) });
  const current = await authority.currentOn(artifactReadClient(client));
  return current.readable ? digest(JSON.stringify([current.revision, artifact.rows[0].revision, grants.rows, pointerRevision])) : undefined;
}

/** No listeners, cookies, signing or MFA. W3.b may sign only an acknowledged consume result. */
export function createArtifactReaderActivation(options: {
  pool: Pool; baseDomain: string; profileDigest: string; ticketTtlSeconds?: number; flowTtlSeconds?: number;
}) {
  const { pool, baseDomain, profileDigest, ticketTtlSeconds = 60, flowTtlSeconds = 30 } = options;
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(baseDomain) || !baseDomain.includes('.') ||
    !/^[0-9a-f]{64}$/.test(profileDigest)) throw denied();
  const stores = new Map<string, ReturnType<typeof createArtifactHostActivationStorage>>();
  const storage = (namespace: string) => {
    let store = stores.get(namespace);
    if (!store) {
      store = createArtifactHostActivationStorage({ pool, namespace, ticketTtlSeconds, flowTtlSeconds })
        .catch(error => { stores.delete(namespace); throw error; });
      stores.set(namespace, store);
    }
    return store;
  };
  const verifiedSession = (value: ArtifactReaderSession) => {
    const session = Object.freeze({ ...value });
    if (Object.values(session).length !== 4 || Object.values(session).some(v => typeof v !== 'string' || !v)) throw denied();
    return session;
  };
  const authority = {
    async issue(value: ArtifactReaderSession, input: ArtifactReaderTarget) {
      const session = verifiedSession(value);
      const target = Object.freeze({ ...input });
      const nonce = nonceDigest(target.nonce);
      if (!approvedOrigin(baseDomain, target)) throw denied();
      const namespace = await namespaceFor(pool, session);
      if (!namespace) throw denied();
      const store = await storage(namespace);
      const client = await pool.connect();
      let policyRevision: string | undefined;
      let committing = false;
      let discard = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        policyRevision = await currentPolicy(client, pool, namespace, session, target, baseDomain);
        if (!policyRevision) throw denied();
        committing = true;
        await client.query('COMMIT');
      } catch (error) {
        discard = committing;
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
      return store.issue({ subjectId: session.subjectId, sessionId: session.sessionId,
        artifactId: target.artifactId, releaseId: target.releaseId, channel: target.channel,
        targetOrigin: target.targetOrigin, nonceDigest: nonce, profileDigest, policyRevision });
    },
    async consume(value: ArtifactReaderSession, input: {
      flowId: string; ticketId: string; nonce: string; targetOrigin: string;
    }) {
      const session = verifiedSession(value);
      const request = Object.freeze({ ...input });
      const nonce = nonceDigest(request.nonce);
      const namespace = await namespaceFor(pool, session);
      if (!namespace) return undefined;
      const store = await storage(namespace);
      const flow = await store.flows.peek(request.flowId);
      if (!flow) return undefined;
      const expected: BrowserFlowBinding = { ...flow, subjectId: session.subjectId, sessionId: session.sessionId,
        nonceDigest: nonce, targetOrigin: request.targetOrigin, profileDigest };
      return store.consume({ flowId: request.flowId, ticketId: request.ticketId, expected }, async ({ client, flow: locked }) =>
        await currentPolicy(client, pool, namespace, session, locked, baseDomain) === locked.policyRevision);
    },
  };
  return { ...authority,
    /** Resolve issuing authority through the package flow port, never package-owned SQL. */
    async consumeForContentOrigin(input: Parameters<typeof authority.consume>[1]) {
      const request = Object.freeze({ ...input });
      const url = new URL(request.targetOrigin);
      if (url.protocol !== 'https:' || url.origin !== request.targetOrigin || url.port) return undefined;
      const origin = parseContentHost(url.host, baseDomain);
      if (!origin) return undefined;
      const artifacts = createPostgresArtifactStore(pool);
      const artifactId = origin.kind === 'stable' ? origin.artifactId : (await artifacts.getRelease(origin.releaseId))?.artifactId;
      if (!artifactId) return undefined;
      const namespace = (await artifacts.getArtifactAcl(artifactId))?.storageScopeId;
      if (!namespace) return undefined;
      const { rows } = await pool.query<{ key: string }>(
        `SELECT kv.key FROM control.artifact_host_kv kv JOIN artifacts.storage_scopes s
         ON s.id=kv.value AND s.org_id=(kv.key::jsonb->>0)
         WHERE kv.storage_scope_id='app-artifact-scopes/v1' AND kv.value=$1`, [namespace]);
      if (rows.length !== 1) return undefined;
      const bound: unknown = JSON.parse(rows[0].key);
      if (!Array.isArray(bound) || bound.length !== 2 || bound.some(part => typeof part !== 'string' || !part)) return undefined;
      // Package peek enforces expiry and namespace generation before resolving subject/session.
      const flow = await (await storage(namespace)).flows.peek(request.flowId);
      if (!flow || flow.artifactId !== artifactId || flow.targetOrigin !== request.targetOrigin) return undefined;
      return authority.consume({ tenantId: bound[0] as string, workspaceId: bound[1] as string,
        subjectId: flow.subjectId, sessionId: flow.sessionId }, request);
    },
  };
}
