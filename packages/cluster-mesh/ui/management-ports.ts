export type IdentityScreenText = (key: string, options?: { values?: Record<string, string> }) => string;
export interface IdentityAdminUserView {
  id: string; email: string | null; displayName: string | null;
  role: 'admin_app' | 'admin_org' | 'editor' | 'guest';
  accountStatus: 'active' | 'pending_admin_approval' | 'approval_expired_readonly' | 'disabled_by_user' | 'disabled_by_admin';
  emailVerified: boolean; approvalDueAt: string | null; approvedAt: string | null; approvedByUserId: string | null;
  disabledAt: string | null; disabledReason: string | null; createdAt: string; updatedAt: string | null;
  workspaceId: string | null; workspaceName: string | null;
}
export interface IdentityMembershipView {
  userId: string; tenantId: string; status: string; role: string;
  decidedBy: string | null; decidedAt: string | null; updatedAt: string;
}
export interface IdentityWorkspaceMemberView { userId: string; email: string | null; displayName: string | null; role: string }
export interface IdentityManagementTransport {
  listUsers(status?: string): Promise<{ items: IdentityAdminUserView[] }>;
  approveUser(userId: string, role: IdentityAdminUserView['role']): Promise<void>;
  disableUser(userId: string): Promise<void>;
  reactivateUser(userId: string): Promise<void>;
  deleteUser(userId: string, operationId: string): Promise<{ complete: boolean; operationId: string }>;
  listMemberships(tenantId: string): Promise<{ items: IdentityMembershipView[] }>;
  requestMembership(tenantId: string): Promise<void>;
  decideMembership(tenantId: string, userId: string, decision: 'approve' | 'reject' | 'suspend'): Promise<void>;
  listMembers(workspaceId: string): Promise<{ items: IdentityWorkspaceMemberView[] }>;
  addMember(workspaceId: string, email: string, role: string): Promise<void>;
  setMemberRole(workspaceId: string, userId: string, role: string): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
}
export interface IdentityManagementScreenPorts {
  readonly userId: string | null; readonly role: string | null;
  readonly transport: IdentityManagementTransport; readonly text: IdentityScreenText;
  notify(input: { type: 'success' | 'error' | 'info'; message: string }): void;
  confirm(message: string): boolean | Promise<boolean>;
  operationId(): string;
  refreshWorkspaceScope?(): Promise<void>;
}
