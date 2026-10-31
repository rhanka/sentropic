// Identity core contracts: storage ports. One port per record class; backends
// (PostgreSQL hosted profile, SQLite local profile) implement these ports in
// later lots. Domains orchestrate through ports only, never through a driver.

import type {
  DeviceCodeRecord,
  DivergenceSample,
  DivergenceSummary,
  IdentityAuditEvent,
  IdentityProof,
  InvitationRecord,
  LoginSession,
  OAuthConsentRecord,
  ServiceClientBinding,
  TenantMembershipRecord,
  TenantRecord,
  TenantRole,
  TenantStatus,
  UserAccount,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
  WorkspaceRole,
} from './types.js';

export interface TenantRegistryStore {
  createTenant(record: TenantRecord): Promise<void>;
  findTenant(tenantId: string): Promise<TenantRecord | null>;
  findTenantBySlug(slug: string): Promise<TenantRecord | null>;
  listTenants(): Promise<readonly TenantRecord[]>;
  setTenantStatus(tenantId: string, status: TenantStatus, at: string): Promise<TenantRecord>;
}

export interface UserAccountStore {
  createAccount(record: UserAccount): Promise<void>;
  findAccount(userId: string): Promise<UserAccount | null>;
  findAccountByEmail(email: string): Promise<UserAccount | null>;
  listAccounts(): Promise<readonly UserAccount[]>;
  setAccountStatus(
    userId: string,
    status: UserAccount['accountStatus'],
    at: string,
  ): Promise<UserAccount>;
  setGlobalRole(userId: string, role: UserAccount['globalRole'], at: string): Promise<UserAccount>;
  deleteAccount(userId: string, at: string): Promise<void>;
}

export interface IdentityProofStore {
  addProof(record: IdentityProof): Promise<void>;
  findProof(proofId: string): Promise<IdentityProof | null>;
  listProofsForUser(userId: string): Promise<readonly IdentityProof[]>;
  markProofConsumed(proofId: string, at: string): Promise<IdentityProof>;
  revokeProof(proofId: string, at: string): Promise<IdentityProof>;
}

export interface InvitationStore {
  saveInvitation(record: InvitationRecord): Promise<void>;
  findInvitation(invitationId: string): Promise<InvitationRecord | null>;
  findInvitationByToken(token: string): Promise<InvitationRecord | null>;
  /** Atomically consumes a pending invitation; false when already consumed. */
  markInvitationConsumed(token: string, at: string): Promise<boolean>;
  revokeInvitation(invitationId: string): Promise<InvitationRecord>;
}

export interface DeviceCodeStore {
  saveDeviceCode(record: DeviceCodeRecord): Promise<void>;
  findDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | null>;
  findDeviceCodeByUser(userCode: string): Promise<DeviceCodeRecord | null>;
  /** Atomically approves a pending device code; false when already resolved. */
  approveDeviceCode(userCode: string, approvedUserId: string, at: string): Promise<boolean>;
}

export interface LoginSessionStore {
  createSession(record: LoginSession): Promise<void>;
  findSession(sessionId: string): Promise<LoginSession | null>;
  touchSession(
    sessionId: string,
    update: Pick<LoginSession, 'expiresAt' | 'refreshCount'>,
  ): Promise<LoginSession>;
  revokeSession(sessionId: string, at: string): Promise<LoginSession>;
  revokeAllSessionsForUser(userId: string, at: string): Promise<number>;
  listSessionsForUser(userId: string): Promise<readonly LoginSession[]>;
}

export interface TenantMembershipStore {
  upsertMembershipRequest(record: TenantMembershipRecord): Promise<TenantMembershipRecord>;
  findMembership(userId: string, tenantId: string): Promise<TenantMembershipRecord | null>;
  setMembershipState(
    userId: string,
    tenantId: string,
    state: Pick<TenantMembershipRecord, 'status' | 'tenantRole'> & {
      readonly decidedBy: string;
      readonly decidedAt: string;
      readonly updatedAt: string;
    },
  ): Promise<TenantMembershipRecord>;
  listMembershipsForTenant(tenantId: string): Promise<readonly TenantMembershipRecord[]>;
  listMembershipsForUser(userId: string): Promise<readonly TenantMembershipRecord[]>;
  findApprovedMembership(userId: string, tenantId: string): Promise<TenantMembershipRecord | null>;
}

export interface WorkspaceDirectoryStore {
  enrolWorkspace(record: WorkspaceRecord): Promise<void>;
  findWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  /** Uniqueness read for one workspace per repo (tenant x repoIdentity). */
  findWorkspaceByRepoIdentity(tenantId: string, repoIdentity: string): Promise<WorkspaceRecord | null>;
  listWorkspacesForTenant(tenantId: string): Promise<readonly WorkspaceRecord[]>;
  approveWorkspaceAlias(workspaceId: string, alias: string): Promise<WorkspaceRecord>;
}

export interface WorkspaceMembershipStore {
  putWorkspaceMember(record: WorkspaceMembershipRecord): Promise<WorkspaceMembershipRecord>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  findWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMembershipRecord | null>;
  listWorkspaceMembers(workspaceId: string): Promise<readonly WorkspaceMembershipRecord[]>;
}

export interface OAuthTenantStore {
  grantConsent(record: OAuthConsentRecord): Promise<void>;
  revokeConsent(consentId: string, at: string): Promise<boolean>;
  bindServiceClient(record: ServiceClientBinding): Promise<void>;
  listTenantServiceClients(tenantId: string): Promise<readonly ServiceClientBinding[]>;
}

export interface IdentityAuditPort {
  append(event: IdentityAuditEvent): Promise<void>;
}

export interface DivergenceMetricsPort {
  record(sample: Omit<DivergenceSample, 'at'> & { readonly at?: string }): void;
  summary(): DivergenceSummary;
}

export interface AgentPlaneRevocationPort {
  closeAgentSessionsForUser(userId: string): Promise<number>;
}

export interface InvitationTokenPort {
  issue(): string;
}

export interface IdentityStores {
  readonly tenants: TenantRegistryStore;
  readonly accounts: UserAccountStore;
  readonly proofs: IdentityProofStore;
  readonly invitations: InvitationStore;
  readonly deviceCodes: DeviceCodeStore;
  readonly sessions: LoginSessionStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
  readonly oauth: OAuthTenantStore;
  readonly audit: IdentityAuditPort;
}

export type IdentityPersistenceBinding =
  | { readonly mode: 'LOCAL_ONLY'; readonly local: IdentityStores }
  | { readonly mode: 'DURABLE'; readonly durable: IdentityStores };

export function selectIdentityStores(binding: IdentityPersistenceBinding): IdentityStores {
  return binding.mode === 'LOCAL_ONLY' ? binding.local : binding.durable;
}
