// Identity core contracts: cascading person revocation (F14) and the fresh
// per-request authorisation decision (F09 inputs, F15 decision).
// A refusal yields a stable reason; consumers map it to an empty tool set,
// never to a partial catalogue.

import { IdentityNotFoundError, MembershipTransitionError } from './errors.js';
import type {
  AgentPlaneRevocationPort,
  IdentityAuditPort,
  LoginSessionStore,
  TenantMembershipStore,
  TenantRegistryStore,
  UserAccountStore,
  WorkspaceDirectoryStore,
  WorkspaceMembershipStore,
} from './ports.js';
import {
  systemIdentityClock,
  type DecisionInputKind,
  type FreshDecision,
  type FreshDecisionInput,
  type IdentityClock,
  type PersonRevocationReceipt,
  type RevocationMode,
  type RevocationStepReceipt,
  type SessionAuthorityKind,
} from './types.js';

/** §2.7: one session authority per input kind; the mapping is total. */
const SESSION_AUTHORITY_BY_INPUT_KIND: Record<DecisionInputKind, SessionAuthorityKind> = {
  first_party_http: 'login_session',
  conversation_turn: 'conversation_session',
  agent_plane: 'agent_session',
  runtime_pty: 'runtime_registration',
};

export interface PersonCascade {
  revokePerson(
    userId: string,
    mode: RevocationMode,
    input: { readonly actorId: string },
  ): Promise<PersonRevocationReceipt>;
}

export function createPersonCascade(input: {
  readonly accounts: UserAccountStore;
  readonly sessions: LoginSessionStore;
  readonly memberships: TenantMembershipStore;
  readonly agentPlane?: AgentPlaneRevocationPort;
  readonly audit: IdentityAuditPort;
  readonly clock?: IdentityClock;
}): PersonCascade {
  const clock = input.clock ?? systemIdentityClock;
  return {
    async revokePerson(userId, mode, options) {
      const now = clock();
      const steps: RevocationStepReceipt[] = [];
      try {
        const revoked = await input.sessions.revokeAllSessionsForUser(userId, now);
        steps.push({ step: 'login_sessions', outcome: 'applied', detail: `${revoked} sessions revoked` });
      } catch (error) {
        steps.push({ step: 'login_sessions', outcome: 'queued', detail: String(error) });
      }
      try {
        const memberships = await input.memberships.listMembershipsForUser(userId);
        let suspended = 0;
        for (const membership of memberships) {
          if (membership.status !== 'approved') continue;
          try {
            await input.memberships.setMembershipState(userId, membership.tenantId, {
              status: 'suspended',
              tenantRole: membership.tenantRole,
              decidedBy: options.actorId,
              decidedAt: now,
              updatedAt: now,
            });
            suspended += 1;
          } catch (error) {
            if (!(error instanceof MembershipTransitionError)) throw error;
          }
        }
        steps.push({ step: 'tenant_memberships', outcome: 'applied', detail: `${suspended} memberships suspended` });
      } catch (error) {
        steps.push({ step: 'tenant_memberships', outcome: 'queued', detail: String(error) });
      }
      if (input.agentPlane) {
        try {
          const closed = await input.agentPlane.closeAgentSessionsForUser(userId);
          steps.push({ step: 'agent_plane', outcome: 'applied', detail: `${closed} agent sessions closed` });
        } catch (error) {
          steps.push({ step: 'agent_plane', outcome: 'queued', detail: String(error) });
        }
      } else {
        steps.push({ step: 'agent_plane', outcome: 'queued', detail: 'agent-plane hook not bound; M4 fills this step' });
      }
      try {
        const account = await input.accounts.findAccount(userId);
        if (!account) throw new IdentityNotFoundError('user', userId);
        if (mode === 'delete') {
          await input.accounts.deleteAccount(userId, now);
          steps.push({ step: 'account', outcome: 'applied', detail: 'account deleted' });
        } else {
          await input.accounts.setAccountStatus(userId, 'disabled', now);
          steps.push({ step: 'account', outcome: 'applied', detail: 'account disabled' });
        }
      } catch (error) {
        steps.push({ step: 'account', outcome: 'queued', detail: String(error) });
      }
      const receipt: PersonRevocationReceipt = { userId, mode, steps, at: now };
      await input.audit.append({
        at: now,
        kind: `person.revoked.${mode}`,
        actorId: options.actorId,
        subjectId: userId,
      });
      return receipt;
    },
  };
}

export interface FreshDecisionProducer {
  decide(input: FreshDecisionInput, now: string): Promise<FreshDecision>;
}

export function createFreshDecision(input: {
  readonly accounts: UserAccountStore;
  readonly sessions: LoginSessionStore;
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
}): FreshDecisionProducer {
  return {
    async decide(lookup, now) {
      const sessionAuthority = SESSION_AUTHORITY_BY_INPUT_KIND[lookup.inputKind];
      const account = await input.accounts.findAccount(lookup.userId);
      if (!account || account.accountStatus !== 'active') {
        return { allow: false, sessionAuthority, reason: 'account_not_active' };
      }
      if (lookup.inputKind !== 'first_party_http') {
        // The conversation, agent and runtime authority stores land with their
        // planes (A2.3, M4); until they are bound these kinds fail closed.
        return { allow: false, sessionAuthority, reason: 'session_authority_unavailable' };
      }
      const session = await input.sessions.findSession(lookup.sessionId);
      if (!session || session.userId !== lookup.userId || session.status !== 'active' || session.expiresAt <= now) {
        return { allow: false, sessionAuthority, reason: 'session_invalid' };
      }
      const workspace = await input.workspaces.findWorkspace(lookup.workspaceId);
      if (!workspace) return { allow: false, sessionAuthority, reason: 'workspace_membership_missing' };
      const membership = await input.memberships.findApprovedMembership(lookup.userId, workspace.tenantId);
      if (!membership || membership.status !== 'approved') {
        return { allow: false, sessionAuthority, reason: 'membership_not_approved' };
      }
      const tenant = await input.tenants.findTenant(workspace.tenantId);
      if (!tenant || tenant.status !== 'active') {
        return { allow: false, sessionAuthority, reason: 'tenant_not_active' };
      }
      const workspaceMember = await input.workspaceMembers.findWorkspaceMember(lookup.workspaceId, lookup.userId);
      if (!workspaceMember) return { allow: false, sessionAuthority, reason: 'workspace_membership_missing' };
      return {
        allow: true,
        sessionAuthority,
        tenantId: tenant.tenantId,
        tid: tenant.slug,
        tenantRole: membership.tenantRole,
        workspaceRole: workspaceMember.role,
        scopes: [account.globalRole, `tenant:${membership.tenantRole}`, `workspace:${workspaceMember.role}`],
      };
    },
  };
}
