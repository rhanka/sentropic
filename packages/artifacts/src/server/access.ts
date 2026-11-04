/**
 * L-5c/G1 — access control (spec-v8 §9 5c, converged-r2 §2.1 + owner answers).
 *
 * Three-mode sharing model. `restricted` (default): owner + nominative grants.
 * `platform`: every approved account of the scope reads, never anonymous,
 * never source. `public`: anonymous read only while the sharing policy allows
 * it (§2.2 double lock, fail-closed). The legacy `isPublic` flag maps to
 * `platform`, never `public`. Nominative grants coexist orthogonally with the
 * wide mode. Owner Q1: the collab (`source`) right is nominative only — one
 * named colleague, restricted mode only, never a `sentropic:` sentinel; the
 * schema mirrors this. Owner Q2: grants and platform reads require fresh
 * approval at every read — a paused share resumes automatically once the
 * account is approved again and reports `blockedBy:'account_inactive'`
 * meanwhile; the grant row is kept, never deleted. Owner Q3: the ACL is per
 * artifact, so a share covers all retained versions (no version-scoped state
 * exists here). Withdrawal suspends reader grants (kept for audit, inactive)
 * while the owner keeps access. Grant management is owner-only (duplicates
 * refused); `canManageAccess` adds the server-resolved platform admin, which
 * may revoke and degrade only — never widen, never place a nominative grant.
 */
export type AccessGrant = 'read' | 'source';
export type AccessAction = 'read' | 'source';
export type AccessMode = 'restricted' | 'platform' | 'public';
export type AccessAudience = 'user' | 'platform' | 'public';
export type ModeAction = 'grant' | 'revoke';

/** Reserved principal namespace: wide-audience sentinels, never nominative. */
export const RESERVED_PRINCIPAL_PREFIX = 'sentropic:';
export const PLATFORM_PRINCIPAL = 'sentropic:platform';
export const PUBLIC_PRINCIPAL = 'sentropic:public';

/** Live sharing policy context (fail-closed when absent). */
export interface SharingPolicyContext {
  allowPublicSharing?: boolean;
}

/** Append-only audit event recorded in the same transaction as the mutation. */
export interface AccessEvent {
  artifactId: string;
  actorId: string;
  action: ModeAction;
  audience: AccessAudience;
  /** Target principal for user audience, null for the wide audiences. */
  principalId: string | null;
  policyRevision: string;
}

export interface GrantRecord {
  principalId: string;
  grant: AccessGrant;
  /** Grant creation stamp (migration 0006 `created_at`); absent on legacy rows. */
  createdAt?: string;
}

/** Display metadata of one artifact (title/description/icon); cosmetic, owner-set. */
export interface ArtifactMetadata {
  title?: string;
  description?: string;
  icon?: string | null;
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
  /** Wide sharing mode; absent on legacy ACLs, which read as platform when isPublic. */
  accessMode?: AccessMode;
  /** Display metadata returned by get/list; persisted by the host store. */
  metadata?: ArtifactMetadata;
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

/** Effective wide mode; the legacy isPublic flag reads as platform, never public. */
export function accessModeOf(acl: ArtifactAcl): AccessMode {
  return acl.accessMode ?? (acl.isPublic ? 'platform' : 'restricted');
}

/** True when the actor may perform the action (deny by default). */
export function evaluateAccess(
  acl: ArtifactAcl,
  actorId: string,
  action: AccessAction,
  isApproved: (principalId: string) => boolean = () => false,
  policy: SharingPolicyContext = {},
): boolean {
  if (actorId === acl.ownerId) return true;
  if (acl.withdrawn) return false;
  const mode = accessModeOf(acl);
  if (actorId.length === 0) {
    // Anonymous: public mode read only, and only while the policy allows it.
    return mode === 'public' && action === 'read' && policy.allowPublicSharing === true;
  }
  const grant = acl.grants.find((g) => g.principalId === actorId)?.grant;
  // Fresh approval at every read (owner Q2): suspension pauses, reactivation resumes.
  if (grant === 'source') return isApproved(actorId);
  if (grant === 'read' && action === 'read') return isApproved(actorId);
  if (action === 'read') {
    if (mode === 'platform') return isApproved(actorId);
    if (mode === 'public') return policy.allowPublicSharing === true;
  }
  return false;
}

/** Dormancy report for one nominative grant (owner Q2 paused display). */
export function evaluateGrant(
  acl: ArtifactAcl,
  principalId: string,
  isApproved: (principalId: string) => boolean = () => false,
): { effective: boolean; blockedBy?: 'account_inactive' } {
  const grant = acl.grants.find((g) => g.principalId === principalId);
  if (grant === undefined) return { effective: false };
  if (!isApproved(principalId)) return { effective: false, blockedBy: 'account_inactive' };
  return { effective: true };
}

/** Owner-only: add a grant (duplicates refused; owner Q1 enforced in pure form). */
export function grantAccess(
  acl: ArtifactAcl,
  actorId: string,
  grant: GrantRecord,
): ArtifactAcl {
  if (actorId !== acl.ownerId) throw new Error('access denied: only the owner manages grants');
  if (grant.principalId.length === 0) throw new Error('invalid grant: empty principal');
  if (grant.principalId.startsWith(RESERVED_PRINCIPAL_PREFIX)) {
    throw new Error(`reserved principal prefix: ${grant.principalId}`);
  }
  if (acl.grants.some((g) => g.principalId === grant.principalId)) {
    throw new Error(`duplicate grant for ${grant.principalId}`);
  }
  if (grant.grant === 'source') {
    // Owner Q1: collab is one named colleague, restricted mode only — never
    // platform-wide, never public (the schema enforces the same invariant).
    if (accessModeOf(acl) !== 'restricted') throw new Error('source grant requires restricted mode');
    if (acl.grants.some((g) => g.grant === 'source')) {
      throw new Error('source grant is limited to one named colleague');
    }
  }
  return { ...acl, grants: [...acl.grants, grant] };
}

/** Owner-only: remove a grant (kept for audit by the caller if needed). */
export function revokeAccess(acl: ArtifactAcl, actorId: string, principalId: string): ArtifactAcl {
  if (actorId !== acl.ownerId) throw new Error('access denied: only the owner manages grants');
  return { ...acl, grants: acl.grants.filter((g) => g.principalId !== principalId) };
}

/** Normative mode transitions (converged-r2 §2.1): sentinels only move the wide mode. */
export function applyModeTransition(
  mode: AccessMode,
  action: ModeAction,
  principalId: string,
): { mode: AccessMode; changed: boolean } {
  if (principalId === PLATFORM_PRINCIPAL) {
    if (action === 'grant') return { mode: 'platform', changed: mode !== 'platform' };
    return mode === 'platform' ? { mode: 'restricted', changed: true } : { mode, changed: false };
  }
  if (principalId === PUBLIC_PRINCIPAL) {
    if (action === 'grant') return { mode: 'public', changed: mode !== 'public' };
    return mode === 'public' ? { mode: 'restricted', changed: true } : { mode, changed: false };
  }
  // Nominative principals never change the wide mode.
  return { mode, changed: false };
}

/** Audience class of a principal: the two sentinels are wide, anything else is a user. */
export function audienceOf(principalId: string): AccessAudience {
  if (principalId === PLATFORM_PRINCIPAL) return 'platform';
  if (principalId === PUBLIC_PRINCIPAL) return 'public';
  return 'user';
}

function isManageablePrincipal(principalId: string): boolean {
  return principalId === PLATFORM_PRINCIPAL || principalId === PUBLIC_PRINCIPAL ||
    !principalId.startsWith(RESERVED_PRINCIPAL_PREFIX);
}

/**
 * Management right over one (action, principal) pair. The owner manages every
 * audience; the platform admin — a server-resolved flag only, never a tool
 * argument — may revoke any grant and degrade modes, including the unique
 * `grant sentropic:platform` on a `public` artifact (a strict reduction). The
 * admin never widens a mode and never places a nominative grant.
 */
export function canManageAccess(args: {
  acl: ArtifactAcl;
  actorId: string;
  action: ModeAction;
  principalId: string;
  actorIsAdmin?: boolean;
}): boolean {
  const { acl, actorId, action, principalId } = args;
  if (!isManageablePrincipal(principalId)) return false;
  if (actorId === acl.ownerId) return true;
  if (args.actorIsAdmin !== true) return false;
  if (action === 'revoke') return true;
  return action === 'grant' && principalId === PLATFORM_PRINCIPAL && accessModeOf(acl) === 'public';
}
