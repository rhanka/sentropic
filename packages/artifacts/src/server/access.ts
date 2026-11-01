/**
 * L-5c — access control (spec-v8 §9 5c).
 *
 * Pure evaluation over an artifact ACL: the owner reads, exports source and
 * manages grants; explicit grants give read or source (source implies read,
 * read never implies source); a public flag opens reads to approved accounts
 * only — never anonymous, never source. Withdrawal suspends reader grants
 * (kept for audit, inactive) while the owner keeps access. Grant management
 * is owner-only; duplicate grants are refused. Identity approval comes from
 * the host via an injected predicate (memory double in tests).
 */
export type AccessGrant = 'read' | 'source';
export type AccessAction = 'read' | 'source';

export interface GrantRecord {
  principalId: string;
  grant: AccessGrant;
}

export interface ArtifactAcl {
  bindingName?: string;
  createdAt?: string;
  updatedAt?: string | null;
  title?: string;
  description?: string;
  icon?: string | null;
  ownerId: string;
  /** Physical scope of the artifact (set at creation; read by publish). */
  storageScopeId?: string;
  isPublic: boolean;
  withdrawn: boolean;
  grants: GrantRecord[];
}

export interface AclStore {
  getArtifactAcl(artifactId: string): Promise<ArtifactAcl | undefined>;
  putArtifactAcl(artifactId: string, acl: ArtifactAcl): Promise<void>;
  /** All known artifact IDs (stable creation order); filter by ACL first. */
  listArtifactIds(): Promise<string[]>;
}

/** In-memory AclStore double for unit tests. */
export function createMemoryAclStore(): AclStore {
  const acls = new Map<string, ArtifactAcl>();
  return {
    getArtifactAcl(artifactId: string): Promise<ArtifactAcl | undefined> {
      const acl = acls.get(artifactId);
      return Promise.resolve(
        acl === undefined
          ? undefined
          : { ...acl, grants: acl.grants.map((g) => ({ ...g })) },
      );
    },
    putArtifactAcl(artifactId: string, acl: ArtifactAcl): Promise<void> {
      acls.set(artifactId, { ...acl, grants: acl.grants.map((g) => ({ ...g })) });
      return Promise.resolve();
    },
    listArtifactIds(): Promise<string[]> {
      return Promise.resolve([...acls.keys()]);
    },
  };
}

/** True when the actor may perform the action (deny by default). */
export function evaluateAccess(
  acl: ArtifactAcl,
  actorId: string,
  action: AccessAction,
  isApproved: (principalId: string) => boolean = () => false,
): boolean {
  if (actorId.length === 0) return false;
  if (actorId === acl.ownerId) return true;
  if (acl.withdrawn) return false;
  const grant = acl.grants.find((g) => g.principalId === actorId)?.grant;
  if (grant === 'source') return true;
  if (grant === 'read' && action === 'read') return true;
  if (action === 'read' && acl.isPublic && isApproved(actorId)) return true;
  return false;
}

/** Owner-only: add a grant (duplicates refused). */
export function grantAccess(
  acl: ArtifactAcl,
  actorId: string,
  grant: GrantRecord,
): ArtifactAcl {
  if (actorId !== acl.ownerId) throw new Error('access denied: only the owner manages grants');
  if (grant.principalId.length === 0) throw new Error('invalid grant: empty principal');
  if (acl.grants.some((g) => g.principalId === grant.principalId)) {
    throw new Error(`duplicate grant for ${grant.principalId}`);
  }
  return { ...acl, grants: [...acl.grants, grant] };
}

/** Owner-only: remove a grant (kept for audit by the caller if needed). */
export function revokeAccess(acl: ArtifactAcl, actorId: string, principalId: string): ArtifactAcl {
  if (actorId !== acl.ownerId) throw new Error('access denied: only the owner manages grants');
  return { ...acl, grants: acl.grants.filter((g) => g.principalId !== principalId) };
}
