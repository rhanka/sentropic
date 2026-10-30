// Identity core contracts: in-memory doubles. The only implementation in
// this lane; durable backends (PostgreSQL, SQLite) implement the same ports
// in later lots, and the contract tests run unmodified against them.

import type {
  DeviceCodeStore,
  DivergenceMetricsPort,
  IdentityAuditPort,
  IdentityProofStore,
  InvitationStore,
  InvitationTokenPort,
  LoginSessionStore,
  OAuthTenantStore,
  TenantMembershipStore,
  TenantRegistryStore,
  UserAccountStore,
  WorkspaceDirectoryStore,
  WorkspaceMembershipStore,
  IdentityStores,
} from './ports.js';
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
  TenantStatus,
  UserAccount,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
} from './types.js';

export class InMemoryTenantRegistryStore implements TenantRegistryStore {
  private readonly byId = new Map<string, TenantRecord>();
  private readonly bySlug = new Map<string, string>();

  async createTenant(record: TenantRecord): Promise<void> {
    this.byId.set(record.tenantId, record);
    this.bySlug.set(record.slug, record.tenantId);
  }

  async findTenant(tenantId: string): Promise<TenantRecord | null> {
    return this.byId.get(tenantId) ?? null;
  }

  async findTenantBySlug(slug: string): Promise<TenantRecord | null> {
    const tenantId = this.bySlug.get(slug);
    return tenantId ? (this.byId.get(tenantId) ?? null) : null;
  }

  async listTenants(): Promise<readonly TenantRecord[]> {
    return [...this.byId.values()];
  }

  async setTenantStatus(tenantId: string, status: TenantStatus, _at: string): Promise<TenantRecord> {
    const existing = this.byId.get(tenantId);
    if (!existing) throw new Error(`Tenant not found: ${tenantId}`);
    const updated: TenantRecord = { ...existing, status };
    this.byId.set(tenantId, updated);
    return updated;
  }
}

export class InMemoryUserAccountStore implements UserAccountStore {
  private readonly byId = new Map<string, UserAccount>();
  private readonly byEmail = new Map<string, string>();

  async createAccount(record: UserAccount): Promise<void> {
    this.byId.set(record.userId, record);
    this.byEmail.set(record.email, record.userId);
  }

  async findAccount(userId: string): Promise<UserAccount | null> {
    return this.byId.get(userId) ?? null;
  }

  async findAccountByEmail(email: string): Promise<UserAccount | null> {
    const userId = this.byEmail.get(email);
    return userId ? (this.byId.get(userId) ?? null) : null;
  }

  async listAccounts(): Promise<readonly UserAccount[]> {
    return [...this.byId.values()];
  }

  async setAccountStatus(
    userId: string,
    status: UserAccount['accountStatus'],
    at: string,
  ): Promise<UserAccount> {
    return this.update(userId, { accountStatus: status, updatedAt: at });
  }

  async setGlobalRole(userId: string, role: UserAccount['globalRole'], at: string): Promise<UserAccount> {
    return this.update(userId, { globalRole: role, updatedAt: at });
  }

  async deleteAccount(userId: string, _at: string): Promise<void> {
    const existing = this.byId.get(userId);
    if (existing) {
      this.byId.delete(userId);
      this.byEmail.delete(existing.email);
    }
  }

  private update(userId: string, patch: Partial<UserAccount>): UserAccount {
    const existing = this.byId.get(userId);
    if (!existing) throw new Error(`Account not found: ${userId}`);
    const updated: UserAccount = { ...existing, ...patch };
    this.byId.set(userId, updated);
    return updated;
  }
}

export class InMemoryIdentityProofStore implements IdentityProofStore {
  private readonly byId = new Map<string, IdentityProof>();

  async addProof(record: IdentityProof): Promise<void> {
    this.byId.set(record.proofId, record);
  }

  async findProof(proofId: string): Promise<IdentityProof | null> {
    return this.byId.get(proofId) ?? null;
  }

  async listProofsForUser(userId: string): Promise<readonly IdentityProof[]> {
    return [...this.byId.values()].filter((proof) => proof.userId === userId);
  }

  async markProofConsumed(proofId: string, at: string): Promise<IdentityProof> {
    return this.update(proofId, { consumedAt: at });
  }

  async revokeProof(proofId: string, at: string): Promise<IdentityProof> {
    return this.update(proofId, { revokedAt: at });
  }

  private update(proofId: string, patch: Partial<IdentityProof>): IdentityProof {
    const existing = this.byId.get(proofId);
    if (!existing) throw new Error(`Proof not found: ${proofId}`);
    const updated: IdentityProof = { ...existing, ...patch };
    this.byId.set(proofId, updated);
    return updated;
  }
}

export class InMemoryInvitationStore implements InvitationStore {
  private readonly byId = new Map<string, InvitationRecord>();
  private readonly byToken = new Map<string, string>();

  async saveInvitation(record: InvitationRecord): Promise<void> {
    this.byId.set(record.invitationId, record);
    this.byToken.set(record.token, record.invitationId);
  }

  async findInvitation(invitationId: string): Promise<InvitationRecord | null> {
    return this.byId.get(invitationId) ?? null;
  }

  async findInvitationByToken(token: string): Promise<InvitationRecord | null> {
    const invitationId = this.byToken.get(token);
    return invitationId ? (this.byId.get(invitationId) ?? null) : null;
  }

  async markInvitationConsumed(token: string, at: string): Promise<boolean> {
    const invitationId = this.byToken.get(token);
    if (!invitationId) return false;
    const existing = this.byId.get(invitationId);
    if (!existing || existing.status !== 'pending') return false;
    this.byId.set(invitationId, { ...existing, status: 'consumed', consumedAt: at });
    return true;
  }

  async revokeInvitation(invitationId: string): Promise<InvitationRecord> {
    const existing = this.byId.get(invitationId);
    if (!existing) throw new Error(`Invitation not found: ${invitationId}`);
    const updated: InvitationRecord = { ...existing, status: 'revoked' };
    this.byId.set(invitationId, updated);
    return updated;
  }
}

export class InMemoryDeviceCodeStore implements DeviceCodeStore {
  private readonly byDeviceCode = new Map<string, DeviceCodeRecord>();
  private readonly byUserCode = new Map<string, DeviceCodeRecord>();

  async saveDeviceCode(record: DeviceCodeRecord): Promise<void> {
    this.byDeviceCode.set(record.deviceCode, record);
    this.byUserCode.set(record.userCode, record);
  }

  async findDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | null> {
    return this.byDeviceCode.get(deviceCode) ?? null;
  }

  async findDeviceCodeByUser(userCode: string): Promise<DeviceCodeRecord | null> {
    return this.byUserCode.get(userCode) ?? null;
  }

  async approveDeviceCode(userCode: string, approvedUserId: string, at: string): Promise<boolean> {
    const existing = this.byUserCode.get(userCode);
    if (!existing || existing.status !== 'pending') return false;
    const updated: DeviceCodeRecord = {
      ...existing,
      status: 'approved',
      approvedUserId,
      approvedAt: at,
    };
    this.byDeviceCode.set(updated.deviceCode, updated);
    this.byUserCode.set(updated.userCode, updated);
    return true;
  }
}

export class InMemoryLoginSessionStore implements LoginSessionStore {
  private readonly byId = new Map<string, LoginSession>();

  async createSession(record: LoginSession): Promise<void> {
    this.byId.set(record.sessionId, record);
  }

  async findSession(sessionId: string): Promise<LoginSession | null> {
    return this.byId.get(sessionId) ?? null;
  }

  async touchSession(
    sessionId: string,
    update: Pick<LoginSession, 'expiresAt' | 'refreshCount'>,
  ): Promise<LoginSession> {
    const existing = this.byId.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const updated: LoginSession = { ...existing, ...update };
    this.byId.set(sessionId, updated);
    return updated;
  }

  async revokeSession(sessionId: string, at: string): Promise<LoginSession> {
    const existing = this.byId.get(sessionId);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    const updated: LoginSession = { ...existing, status: 'revoked', revokedAt: at };
    this.byId.set(sessionId, updated);
    return updated;
  }

  async revokeAllSessionsForUser(userId: string, at: string): Promise<number> {
    let revoked = 0;
    for (const session of this.byId.values()) {
      if (session.userId === userId && session.status === 'active') {
        this.byId.set(session.sessionId, { ...session, status: 'revoked', revokedAt: at });
        revoked += 1;
      }
    }
    return revoked;
  }

  async listSessionsForUser(userId: string): Promise<readonly LoginSession[]> {
    return [...this.byId.values()].filter((session) => session.userId === userId);
  }
}

export class InMemoryTenantMembershipStore implements TenantMembershipStore {
  private readonly rows = new Map<string, TenantMembershipRecord>();

  private key(userId: string, tenantId: string): string {
    return `${userId}/${tenantId}`;
  }

  async upsertMembershipRequest(record: TenantMembershipRecord): Promise<TenantMembershipRecord> {
    this.rows.set(this.key(record.userId, record.tenantId), record);
    return record;
  }

  async findMembership(userId: string, tenantId: string): Promise<TenantMembershipRecord | null> {
    return this.rows.get(this.key(userId, tenantId)) ?? null;
  }

  async setMembershipState(
    userId: string,
    tenantId: string,
    state: Pick<TenantMembershipRecord, 'status' | 'tenantRole'> & {
      readonly decidedBy: string;
      readonly decidedAt: string;
      readonly updatedAt: string;
    },
  ): Promise<TenantMembershipRecord> {
    const existing = this.rows.get(this.key(userId, tenantId));
    if (!existing) throw new Error(`Membership not found: ${userId}/${tenantId}`);
    const updated: TenantMembershipRecord = { ...existing, ...state };
    this.rows.set(this.key(userId, tenantId), updated);
    return updated;
  }

  async listMembershipsForTenant(tenantId: string): Promise<readonly TenantMembershipRecord[]> {
    return [...this.rows.values()].filter((row) => row.tenantId === tenantId);
  }

  async listMembershipsForUser(userId: string): Promise<readonly TenantMembershipRecord[]> {
    return [...this.rows.values()].filter((row) => row.userId === userId);
  }

  async findApprovedMembership(userId: string, tenantId: string): Promise<TenantMembershipRecord | null> {
    const row = this.rows.get(this.key(userId, tenantId));
    return row && row.status === 'approved' ? row : null;
  }
}

export class InMemoryWorkspaceDirectoryStore implements WorkspaceDirectoryStore {
  private readonly byId = new Map<string, WorkspaceRecord>();

  async enrolWorkspace(record: WorkspaceRecord): Promise<void> {
    this.byId.set(record.workspaceId, record);
  }

  async findWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    return this.byId.get(workspaceId) ?? null;
  }

  async findWorkspaceByRepoIdentity(tenantId: string, repoIdentity: string): Promise<WorkspaceRecord | null> {
    for (const workspace of this.byId.values()) {
      if (workspace.tenantId === tenantId && workspace.repoIdentity === repoIdentity) return workspace;
    }
    return null;
  }

  async listWorkspacesForTenant(tenantId: string): Promise<readonly WorkspaceRecord[]> {
    return [...this.byId.values()].filter((workspace) => workspace.tenantId === tenantId);
  }

  async approveWorkspaceAlias(workspaceId: string, alias: string): Promise<WorkspaceRecord> {
    const existing = this.byId.get(workspaceId);
    if (!existing) throw new Error(`Workspace not found: ${workspaceId}`);
    const updated: WorkspaceRecord = {
      ...existing,
      aliases: existing.aliases.includes(alias) ? existing.aliases : [...existing.aliases, alias],
    };
    this.byId.set(workspaceId, updated);
    return updated;
  }
}

export class InMemoryWorkspaceMembershipStore implements WorkspaceMembershipStore {
  private readonly rows = new Map<string, WorkspaceMembershipRecord>();

  private key(workspaceId: string, userId: string): string {
    return `${workspaceId}/${userId}`;
  }

  async putWorkspaceMember(record: WorkspaceMembershipRecord): Promise<WorkspaceMembershipRecord> {
    this.rows.set(this.key(record.workspaceId, record.userId), record);
    return record;
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    return this.rows.delete(this.key(workspaceId, userId));
  }

  async findWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMembershipRecord | null> {
    return this.rows.get(this.key(workspaceId, userId)) ?? null;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<readonly WorkspaceMembershipRecord[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === workspaceId);
  }
}

export class InMemoryOAuthTenantStore implements OAuthTenantStore {
  private readonly consents = new Map<string, OAuthConsentRecord>();
  private readonly clients = new Map<string, ServiceClientBinding>();

  async grantConsent(record: OAuthConsentRecord): Promise<void> {
    this.consents.set(record.consentId, record);
  }

  async revokeConsent(consentId: string, at: string): Promise<boolean> {
    const existing = this.consents.get(consentId);
    if (!existing) return false;
    this.consents.set(consentId, { ...existing, revokedAt: at });
    return true;
  }

  async bindServiceClient(record: ServiceClientBinding): Promise<void> {
    this.clients.set(record.clientId, record);
  }

  async listTenantServiceClients(tenantId: string): Promise<readonly ServiceClientBinding[]> {
    return [...this.clients.values()].filter((client) => client.tenantId === tenantId);
  }
}

export class InMemoryIdentityAudit implements IdentityAuditPort {
  readonly events: IdentityAuditEvent[] = [];

  async append(event: IdentityAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

export class InMemoryDivergenceMetrics implements DivergenceMetricsPort {
  private samples: DivergenceSample[] = [];

  record(sample: Omit<DivergenceSample, 'at'> & { readonly at?: string }): void {
    this.samples.push({ ...sample, at: sample.at ?? new Date().toISOString() });
  }

  summary(): DivergenceSummary {
    return {
      samples: this.samples.length,
      diverged: this.samples.filter((sample) => sample.diverged).length,
    };
  }
}

export class StubTokenPort implements InvitationTokenPort {
  private counter = 0;

  issue(): string {
    this.counter += 1;
    return `test-${this.counter}`;
  }
}

export function createStubTokenPort(): InvitationTokenPort {
  return new StubTokenPort();
}

export function createInMemoryIdentityStores(): IdentityStores {
  return {
    tenants: new InMemoryTenantRegistryStore(),
    accounts: new InMemoryUserAccountStore(),
    proofs: new InMemoryIdentityProofStore(),
    invitations: new InMemoryInvitationStore(),
    deviceCodes: new InMemoryDeviceCodeStore(),
    sessions: new InMemoryLoginSessionStore(),
    memberships: new InMemoryTenantMembershipStore(),
    workspaces: new InMemoryWorkspaceDirectoryStore(),
    workspaceMembers: new InMemoryWorkspaceMembershipStore(),
    oauth: new InMemoryOAuthTenantStore(),
    audit: new InMemoryIdentityAudit(),
  };
}

export function createInMemoryDivergenceMetrics(): DivergenceMetricsPort {
  return new InMemoryDivergenceMetrics();
}
