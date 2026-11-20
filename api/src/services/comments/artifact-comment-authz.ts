import type { Pool } from 'pg';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { isArtifactId } from '@sentropic/artifacts/contracts';
import { evaluateAccess, type ArtifactAcl, type SharingPolicyContext } from '@sentropic/artifacts/server/access';
import type { ArtifactState } from '@sentropic/artifacts/server/lifecycle';
import {
  createArtifactAuthorization,
  type ArtifactAuthority,
  type ArtifactHostIdentity,
  type CurrentArtifactIdentity,
} from '../artifacts/authorization';

export interface ArtifactCommentTargetRequest {
  readonly identity: ArtifactHostIdentity;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly action?: 'read' | 'comment';
}

export type ArtifactCommentRefusal =
  | { readonly ok: false; readonly status: 404; readonly code: 'artifact_not_found' }
  | { readonly ok: false; readonly status: 403; readonly code: 'comment_forbidden' };

export interface ArtifactCommentAuthorized {
  readonly ok: true;
  readonly artifactId: string;
  readonly workspaceId: string;
  readonly storageScopeId: string;
  readonly authority: ArtifactAuthority;
}

export type ArtifactCommentAuthzResult = ArtifactCommentAuthorized | ArtifactCommentRefusal;

export interface ArtifactCommentAuthzPorts {
  resolveAuthority(identity: ArtifactHostIdentity, workspaceId: string): Promise<ArtifactAuthority>;
  resolveStorageScopeId(tenantId: string, workspaceId: string): Promise<string | undefined>;
  getArtifactAcl(artifactId: string): Promise<ArtifactAcl | undefined>;
  getArtifactState(artifactId: string): Promise<ArtifactState>;
  sharingPolicy?(storageScopeId: string): Promise<SharingPolicyContext> | SharingPolicyContext;
}

const NOT_FOUND: ArtifactCommentRefusal = Object.freeze({ ok: false, status: 404, code: 'artifact_not_found' });
const FORBIDDEN: ArtifactCommentRefusal = Object.freeze({ ok: false, status: 403, code: 'comment_forbidden' });
const CLOSED_POLICY: SharingPolicyContext = Object.freeze({ allowPublicSharing: false });

async function resolveSharingPolicy(
  sharingPolicy: ArtifactCommentAuthzPorts['sharingPolicy'],
  storageScopeId: string,
): Promise<SharingPolicyContext> {
  if (typeof sharingPolicy !== 'function') return CLOSED_POLICY;
  try {
    const resolved = await sharingPolicy(storageScopeId);
    if (resolved !== null && typeof resolved === 'object' && typeof resolved.allowPublicSharing === 'boolean') {
      return { allowPublicSharing: resolved.allowPublicSharing };
    }
    return CLOSED_POLICY;
  } catch {
    return CLOSED_POLICY;
  }
}

function isArtifactVisible(
  acl: ArtifactAcl,
  state: ArtifactState,
  actorId: string,
  approved: boolean,
  policy: SharingPolicyContext,
): boolean {
  if (state === 'deleted' || state === 'purged') return false;
  if (state === 'withdrawn') return actorId === acl.ownerId;
  return evaluateAccess(acl, actorId, 'read', () => approved, policy);
}

/** Resolve that the artifact exists in the caller's workspace and may be read or commented on. */
export function createArtifactCommentAuthz(ports: ArtifactCommentAuthzPorts) {
  return async (request: ArtifactCommentTargetRequest): Promise<ArtifactCommentAuthzResult> => {
    const { identity, workspaceId, artifactId, action = 'comment' } = request;
    if (
      !identity
      || typeof identity.subject !== 'string' || !identity.subject || identity.subject.includes('|')
      || typeof identity.tenantId !== 'string' || !identity.tenantId
      || typeof identity.clientId !== 'string' || !identity.clientId
      || typeof identity.credentialId !== 'string' || !identity.credentialId
      || typeof workspaceId !== 'string' || !workspaceId
      || !isArtifactId(artifactId)
    ) {
      return NOT_FOUND;
    }
    if (action !== 'read' && action !== 'comment') return FORBIDDEN;
    const authority = await ports.resolveAuthority(identity, workspaceId);
    if (!authority.readable) return NOT_FOUND;
    const storageScopeId = await ports.resolveStorageScopeId(identity.tenantId, workspaceId);
    if (!storageScopeId) return NOT_FOUND;
    const acl = await ports.getArtifactAcl(artifactId);
    if (!acl || acl.storageScopeId !== storageScopeId) return NOT_FOUND;
    const state = await ports.getArtifactState(artifactId);
    const policy = await resolveSharingPolicy(ports.sharingPolicy, storageScopeId);
    if (!isArtifactVisible(acl, state, identity.subject, authority.readable, policy)) return NOT_FOUND;
    if (action === 'comment' && !authority.commentable) return FORBIDDEN;
    return { ok: true, artifactId, workspaceId, storageScopeId, authority };
  };
}

/** Postgres-backed resolver sharing the host's workspace scope mapping and authority source. */
export function createPostgresArtifactCommentAuthz(options: {
  pool: Pool;
  currentIdentity: CurrentArtifactIdentity;
  sharingPolicy?: ArtifactCommentAuthzPorts['sharingPolicy'];
}) {
  const store = createPostgresArtifactStore(options.pool);
  return createArtifactCommentAuthz({
    resolveAuthority: (identity, workspaceId) =>
      createArtifactAuthorization({
        identity, workspaceId, storageScopeId: '', pool: options.pool, currentIdentity: options.currentIdentity,
      }).current(),
    async resolveStorageScopeId(tenantId, workspaceId) {
      const { rows } = await options.pool.query<{ value: string }>(
        `SELECT kv.value FROM control.artifact_host_kv kv
         JOIN artifacts.storage_scopes s ON s.id = kv.value AND s.org_id = $2
         WHERE kv.storage_scope_id = 'app-artifact-scopes/v1' AND kv.key = $1`,
        [JSON.stringify([tenantId, workspaceId]), tenantId],
      );
      return rows[0]?.value;
    },
    getArtifactAcl: (artifactId) => store.getArtifactAcl(artifactId),
    getArtifactState: (artifactId) => store.getArtifactState(artifactId),
    sharingPolicy: options.sharingPolicy,
  });
}
