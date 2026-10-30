// Identity core contracts: human-plane record types (F01-F10, F12-F15).
// Records only; stores, decisions and doubles live in sibling modules.
// Timestamps are ISO-8601 strings; ids are opaque cluster-mesh-owned values.

export type AccountStatus = 'pending_admin_approval' | 'active' | 'disabled' | 'deleted';

export type GlobalRole = 'admin_app' | 'admin_org' | 'editor' | 'guest';

export interface UserAccount {
  readonly userId: string;
  readonly email: string;
  readonly accountStatus: AccountStatus;
  readonly globalRole: GlobalRole;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RegisterAccountInput {
  readonly userId: string;
  readonly email: string;
}

export type IdentityProofKind = 'webauthn' | 'email_code' | 'magic_link' | 'social';

export interface IdentityProof {
  readonly proofId: string;
  readonly userId: string;
  readonly kind: IdentityProofKind;
  readonly provider?: string;
  readonly expiresAt?: string;
  readonly consumedAt?: string;
  readonly revokedAt?: string;
  readonly createdAt: string;
}

export interface VerifiedProofSubject {
  readonly proofId: string;
  readonly userId: string;
  readonly kind: IdentityProofKind;
}

export interface InvitationInput {
  readonly invitationId: string;
  readonly email: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly expiresAt: string;
}

export type InvitationStatus = 'pending' | 'consumed' | 'revoked';

export interface InvitationRecord extends InvitationInput {
  readonly token: string;
  readonly status: InvitationStatus;
  readonly consumedAt?: string;
}

export interface ConsumeInvitationResult {
  readonly invitation: InvitationRecord;
  readonly emailVerified: true;
}

export interface LoginSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly mfaState?: 'none' | 'step_up';
}

export type LoginSessionStatus = 'active' | 'revoked' | 'expired';

export interface LoginSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly status: LoginSessionStatus;
  readonly mfaState: 'none' | 'step_up';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly refreshCount: number;
}

export type TenantStatus = 'active' | 'suspended' | 'offboarded';

export interface TenantRecord {
  readonly tenantId: string;
  readonly slug: string;
  readonly status: TenantStatus;
  readonly createdAt: string;
}

export type TenantMembershipStatus = 'invited' | 'requested' | 'approved' | 'rejected' | 'suspended';

export type TenantRole = 'member' | 'admin';

export interface TenantMembershipRecord {
  readonly userId: string;
  readonly tenantId: string;
  readonly status: TenantMembershipStatus;
  readonly tenantRole: TenantRole;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly updatedAt: string;
}

export type MembershipDecision = 'approve' | 'reject' | 'suspend';

export interface MembershipRequestReceipt {
  readonly received: true;
}

export type WorkspaceRole = 'viewer' | 'commenter' | 'editor' | 'admin';

export interface WorkspaceRecord {
  readonly workspaceId: string;
  readonly tenantId: string;
  /** Canonical repository identity; null records a repo-less workspace (Q-A):
      visible, with no agents and no repo memory until bound or closed. */
  readonly repoIdentity: string | null;
  readonly aliases: readonly string[];
  readonly enrolledAt: string;
}

export interface WorkspaceMembershipRecord {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
}

export type TenantResolutionMode = 'alias' | 'shadow' | 'strict';

export interface AuthoritativeResolution {
  readonly tid: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly membershipRevision: string;
}

export interface ShadowComparison {
  readonly mode: 'shadow';
  readonly authoritative: AuthoritativeResolution | null;
  readonly legacyTid: string;
  readonly diverged: boolean;
}

export interface DivergenceSample {
  readonly workspaceId: string;
  readonly userId: string;
  readonly diverged: boolean;
  readonly at: string;
}

export interface DivergenceSummary {
  readonly samples: number;
  readonly diverged: number;
}

export interface TidClaim {
  readonly tid: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly issuedAt: string;
}

export interface OAuthConsentRecord {
  readonly consentId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly grantedAt: string;
  readonly revokedAt?: string;
}

export interface ServiceClientBinding {
  readonly clientId: string;
  readonly tenantId: string;
  readonly boundAt: string;
}

export type RevocationMode = 'disable' | 'delete';

export type RevocationStepKind = 'account' | 'login_sessions' | 'tenant_memberships' | 'agent_plane';

export type RevocationStepOutcome = 'applied' | 'queued' | 'not_applicable';

export interface RevocationStepReceipt {
  readonly step: RevocationStepKind;
  readonly outcome: RevocationStepOutcome;
  readonly detail: string;
}

export interface PersonRevocationReceipt {
  readonly userId: string;
  readonly mode: RevocationMode;
  readonly steps: readonly RevocationStepReceipt[];
  readonly at: string;
}

/** §2.7 input kinds: every decision names the session authority it evaluates. */
export type DecisionInputKind = 'first_party_http' | 'conversation_turn' | 'agent_plane' | 'runtime_pty';

/** §2.7 session authorities, one per input kind; the runtime registration is
    liveness/custody evidence and never substitutes for an authority above. */
export type SessionAuthorityKind =
  | 'login_session'
  | 'conversation_session'
  | 'agent_session'
  | 'runtime_registration';

export interface FirstPartyHttpDecisionInput {
  readonly inputKind: 'first_party_http';
  readonly userId: string;
  readonly workspaceId: string;
  /** LoginSession id (F05), the authority for first-party HTTP requests. */
  readonly sessionId: string;
}

export interface ConversationTurnDecisionInput {
  readonly inputKind: 'conversation_turn';
  readonly userId: string;
  readonly workspaceId: string;
  /** Verified conversation session bound to (account, workspace); its store
      lands with the conversation plane (A2.3). */
  readonly conversationSessionId: string;
}

export interface AgentPlaneDecisionInput {
  readonly inputKind: 'agent_plane';
  readonly userId: string;
  readonly workspaceId: string;
  /** Level-2 AgentSession id with a live level-1 association; the agent plane
      lands with M4. */
  readonly agentSessionId: string;
}

export interface RuntimePtyDecisionInput {
  readonly inputKind: 'runtime_pty';
  readonly userId: string;
  readonly workspaceId: string;
  /** Runtime registration (custody/generation); liveness/custody only. */
  readonly runtimeRegistrationId: string;
}

export type FreshDecisionInput =
  | FirstPartyHttpDecisionInput
  | ConversationTurnDecisionInput
  | AgentPlaneDecisionInput
  | RuntimePtyDecisionInput;

export type DecisionRefusalReason =
  | 'account_not_active'
  | 'session_invalid'
  | 'session_authority_unavailable'
  | 'membership_not_approved'
  | 'tenant_not_active'
  | 'workspace_membership_missing';

export type FreshDecision =
  | {
      readonly allow: true;
      /** Session authority evaluated for this decision's input kind (§2.7). */
      readonly sessionAuthority: SessionAuthorityKind;
      readonly tenantId: string;
      readonly tid: string;
      readonly tenantRole: TenantRole;
      readonly workspaceRole: WorkspaceRole;
      readonly scopes: readonly string[];
    }
  | {
      readonly allow: false;
      /** Session authority evaluated for this decision's input kind (§2.7). */
      readonly sessionAuthority: SessionAuthorityKind;
      readonly reason: DecisionRefusalReason;
    };

export type IdentityClock = () => string;

export function systemIdentityClock(): string {
  return new Date().toISOString();
}

export interface IdentityAuditEvent {
  readonly at: string;
  readonly kind: string;
  readonly actorId?: string;
  readonly subjectId?: string;
  readonly detail?: string;
}
