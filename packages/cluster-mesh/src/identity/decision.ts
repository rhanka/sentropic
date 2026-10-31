// A2.3 identity slice: the fresh per-request decision producer (spec r2
// §2.7, §4.1, F15) bound over the frozen A2.1/A2.2 store ports plus this
// lot's conversation authority store. The §2.7 `inputKind`/session-authority
// shape is frozen in the identity contracts: every verdict names the session
// authority evaluated for its input kind, and every refusal uses the frozen
// reason vocabulary. `first_party_http` delegates to the frozen
// `createFreshDecision` unchanged; `conversation_turn` binds the conversation
// authority store that lands with this lot; `agent_plane` and `runtime_pty`
// stay unbound until M4 and keep refusing `session_authority_unavailable`.
// A refusal yields an empty tool set — never a partial catalogue.

import { createFreshDecision } from '../identity-contracts/enforcement.js';
import type {
  LoginSessionStore,
  TenantMembershipStore,
  TenantRegistryStore,
  UserAccountStore,
  WorkspaceDirectoryStore,
  WorkspaceMembershipStore,
} from '../identity-contracts/ports.js';
import type {
  DecisionInputKind,
  FreshDecision,
  FreshDecisionInput,
  SessionAuthorityKind,
} from '../identity-contracts/types.js';
import type { ConversationAuthorityStore } from './conversation.js';

/** Maps the allowed decision to this call's tool set; the producer owns the
    empty-on-refusal rule so no consumer can serve a partial catalogue. */
export interface DecisionToolCatalog {
  toolsForDecision(decision: Extract<FreshDecision, { allow: true }>): readonly string[];
}

export interface FreshDecisionWithTools {
  readonly decision: FreshDecision;
  readonly allowedTools: readonly string[];
}

export interface FreshDecisionProducerWithTools {
  decide(input: FreshDecisionInput, now: string): Promise<FreshDecisionWithTools>;
}

/** §2.7 session authority per input kind; same frozen mapping as the
    contracts (the table is total and never recomputed per call). */
const SESSION_AUTHORITY_BY_INPUT_KIND: Record<DecisionInputKind, SessionAuthorityKind> = {
  first_party_http: 'login_session',
  conversation_turn: 'conversation_session',
  agent_plane: 'agent_session',
  runtime_pty: 'runtime_registration',
};

export function createFreshDecisionProducer(input: {
  readonly accounts: UserAccountStore;
  readonly sessions: LoginSessionStore;
  readonly tenants: TenantRegistryStore;
  readonly memberships: TenantMembershipStore;
  readonly workspaces: WorkspaceDirectoryStore;
  readonly workspaceMembers: WorkspaceMembershipStore;
  readonly conversations: ConversationAuthorityStore;
  readonly catalog: DecisionToolCatalog;
}): FreshDecisionProducerWithTools {
  const delegated = createFreshDecision({
    accounts: input.accounts,
    sessions: input.sessions,
    tenants: input.tenants,
    memberships: input.memberships,
    workspaces: input.workspaces,
    workspaceMembers: input.workspaceMembers,
  });
  const refuse = (
    inputKind: DecisionInputKind,
    reason: Extract<FreshDecision, { allow: false }>['reason'],
  ): FreshDecisionWithTools => ({
    decision: { allow: false, sessionAuthority: SESSION_AUTHORITY_BY_INPUT_KIND[inputKind], reason },
    allowedTools: [],
  });
  const decideConversationTurn = async (
    lookup: Extract<FreshDecisionInput, { inputKind: 'conversation_turn' }>,
    now: string,
  ): Promise<FreshDecisionWithTools> => {
    const account = await input.accounts.findAccount(lookup.userId);
    if (!account || account.accountStatus !== 'active') {
      return refuse(lookup.inputKind, 'account_not_active');
    }
    const conversation = await input.conversations.findSession(lookup.conversationSessionId);
    if (
      !conversation ||
      conversation.userId !== lookup.userId ||
      conversation.workspaceId !== lookup.workspaceId ||
      conversation.status !== 'active' ||
      conversation.expiresAt <= now
    ) {
      return refuse(lookup.inputKind, 'session_invalid');
    }
    const workspace = await input.workspaces.findWorkspace(lookup.workspaceId);
    if (!workspace) return refuse(lookup.inputKind, 'workspace_membership_missing');
    const membership = await input.memberships.findApprovedMembership(lookup.userId, workspace.tenantId);
    if (!membership) return refuse(lookup.inputKind, 'membership_not_approved');
    const tenant = await input.tenants.findTenant(workspace.tenantId);
    if (!tenant || tenant.status !== 'active') return refuse(lookup.inputKind, 'tenant_not_active');
    const workspaceMember = await input.workspaceMembers.findWorkspaceMember(lookup.workspaceId, lookup.userId);
    if (!workspaceMember) return refuse(lookup.inputKind, 'workspace_membership_missing');
    const decision: FreshDecision = {
      allow: true,
      sessionAuthority: 'conversation_session',
      tenantId: tenant.tenantId,
      tid: tenant.slug,
      tenantRole: membership.tenantRole,
      workspaceRole: workspaceMember.role,
      scopes: [
        account.globalRole,
        `tenant:${membership.tenantRole}`,
        `workspace:${workspaceMember.role}`,
      ],
    };
    return { decision, allowedTools: [...input.catalog.toolsForDecision(decision)] };
  };
  return {
    async decide(lookup, now) {
      let decision: FreshDecision;
      if (lookup.inputKind === 'first_party_http') {
        decision = await delegated.decide(lookup, now);
      } else if (lookup.inputKind === 'conversation_turn') {
        return decideConversationTurn(lookup, now);
      } else {
        // Unbound kinds fail closed until their authority stores land (M4).
        decision = {
          allow: false,
          sessionAuthority: SESSION_AUTHORITY_BY_INPUT_KIND[lookup.inputKind],
          reason: 'session_authority_unavailable',
        };
      }
      return {
        decision,
        allowedTools: decision.allow ? [...input.catalog.toolsForDecision(decision)] : [],
      };
    },
  };
}
