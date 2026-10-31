// Identity core contracts: workspaces per repo and workspace memberships (F08).
// By default a workspace may use every enrolled CLI; a restriction is an
// explicit policy record owned by a later lot, never an absence side effect.

import { IdentityConflictError, IdentityNotFoundError, WorkspaceAlreadyEnrolledError } from './errors.js';
import type {
  IdentityAuditPort,
  WorkspaceDirectoryStore,
  WorkspaceMembershipStore,
} from './ports.js';
import {
  systemIdentityClock,
  type IdentityClock,
  type WorkspaceMembershipRecord,
  type WorkspaceRecord,
  type WorkspaceRole,
} from './types.js';

export interface WorkspaceDirectoryDomain {
  enrolWorkspace(input: {
    readonly workspaceId: string;
    readonly tenantId: string;
    readonly repoIdentity: string | null;
    readonly creatorUserId: string;
  }): Promise<WorkspaceRecord>;
  getWorkspace(workspaceId: string): Promise<WorkspaceRecord>;
  addWorkspaceMember(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly role: WorkspaceRole;
    readonly actorId: string;
  }): Promise<WorkspaceMembershipRecord>;
  setWorkspaceRole(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly role: WorkspaceRole;
    readonly actorId: string;
  }): Promise<WorkspaceMembershipRecord>;
  removeWorkspaceMember(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly actorId: string;
  }): Promise<boolean>;
  approveWorkspaceAlias(workspaceId: string, alias: string, actorId: string): Promise<WorkspaceRecord>;
  listWorkspaceMembers(workspaceId: string): Promise<readonly WorkspaceMembershipRecord[]>;
}

export function createWorkspaceDirectory(input: {
  readonly workspaces: WorkspaceDirectoryStore;
  readonly members: WorkspaceMembershipStore;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): WorkspaceDirectoryDomain {
  const clock = input.clock ?? systemIdentityClock;
  async function requireWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await input.workspaces.findWorkspace(workspaceId);
    if (!workspace) throw new IdentityNotFoundError('workspace', workspaceId);
    return workspace;
  }
  return {
    async enrolWorkspace(enrolment) {
      const existing = await input.workspaces.findWorkspace(enrolment.workspaceId);
      if (existing) throw new IdentityConflictError('duplicate', `Workspace exists: ${enrolment.workspaceId}`);
      if (enrolment.repoIdentity !== null) {
        const sameRepo = await input.workspaces.findWorkspaceByRepoIdentity(
          enrolment.tenantId,
          enrolment.repoIdentity,
        );
        if (sameRepo) throw new WorkspaceAlreadyEnrolledError(sameRepo.workspaceId);
      }
      const now = clock();
      const record: WorkspaceRecord = {
        workspaceId: enrolment.workspaceId,
        tenantId: enrolment.tenantId,
        repoIdentity: enrolment.repoIdentity,
        aliases: [],
        enrolledAt: now,
      };
      await input.workspaces.enrolWorkspace(record);
      await input.members.putWorkspaceMember({
        workspaceId: record.workspaceId,
        userId: enrolment.creatorUserId,
        role: 'admin',
      });
      await input.audit.append({ at: now, kind: 'workspace.enrolled', subjectId: record.workspaceId });
      return record;
    },
    async getWorkspace(workspaceId) {
      return requireWorkspace(workspaceId);
    },
    async addWorkspaceMember(member) {
      await requireWorkspace(member.workspaceId);
      const now = clock();
      const record = await input.members.putWorkspaceMember({
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
      });
      await input.audit.append({
        at: now,
        kind: 'workspace.member_added',
        actorId: member.actorId,
        subjectId: `${member.workspaceId}/${member.userId}`,
      });
      return record;
    },
    async setWorkspaceRole(member) {
      await requireWorkspace(member.workspaceId);
      const existing = await input.members.findWorkspaceMember(member.workspaceId, member.userId);
      if (!existing) throw new IdentityNotFoundError('membership', `${member.workspaceId}/${member.userId}`);
      const now = clock();
      const record = await input.members.putWorkspaceMember({
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
      });
      await input.audit.append({
        at: now,
        kind: 'workspace.member_role_changed',
        actorId: member.actorId,
        subjectId: `${member.workspaceId}/${member.userId}`,
      });
      return record;
    },
    async removeWorkspaceMember(removal) {
      await requireWorkspace(removal.workspaceId);
      const members = await input.members.listWorkspaceMembers(removal.workspaceId);
      const target = members.find((member) => member.userId === removal.userId);
      if (!target) return false;
      const admins = members.filter((member) => member.role === 'admin');
      if (target.role === 'admin' && admins.length === 1) {
        throw new IdentityConflictError('last_admin', `Cannot remove the last admin of ${removal.workspaceId}`);
      }
      const removed = await input.members.removeWorkspaceMember(removal.workspaceId, removal.userId);
      if (removed) {
        await input.audit.append({
          at: clock(),
          kind: 'workspace.member_removed',
          actorId: removal.actorId,
          subjectId: `${removal.workspaceId}/${removal.userId}`,
        });
      }
      return removed;
    },
    async approveWorkspaceAlias(workspaceId, alias, actorId) {
      await requireWorkspace(workspaceId);
      const updated = await input.workspaces.approveWorkspaceAlias(workspaceId, alias);
      await input.audit.append({
        at: clock(),
        kind: 'workspace.alias_approved',
        actorId,
        subjectId: workspaceId,
        detail: alias,
      });
      return updated;
    },
    async listWorkspaceMembers(workspaceId) {
      await requireWorkspace(workspaceId);
      return input.members.listWorkspaceMembers(workspaceId);
    },
  };
}
