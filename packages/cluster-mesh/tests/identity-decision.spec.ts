// A2.3 spec: the fresh per-request decision producer (§2.7 matrix, F15).
// The three session-invalidity classes stay separate cases — HTTP session
// expiry, logout during a running turn, conversation revocation — because
// each must stop a different authority: login expiry or logout never stops a
// conversation turn, while conversation revocation stops the next turn. A
// mid-session membership suspension empties the tool set on the next call,
// and every refusal yields an empty tool set, never a partial catalogue.

import { describe, expect, it } from 'vitest';
import {
  InMemoryConversationAuthorityStore,
  InMemoryIdentityLedger,
  createConversationAuthority,
  createFreshDecisionProducer,
  createInMemoryIdentityStores,
  type DecisionToolCatalog,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const HALF = '2026-10-30T12:30:00.000Z';
const LATER = '2026-10-30T13:00:00.000Z';

/** Viewer sees fewer tools than an editor; refusals never reach the catalog. */
const catalog: DecisionToolCatalog = {
  toolsForDecision: (decision) =>
    decision.workspaceRole === 'viewer' ? ['mesh.read'] : ['mesh.read', 'mesh.write'],
};

async function setup() {
  const stores = createInMemoryIdentityStores();
  const conversations = new InMemoryConversationAuthorityStore();
  const ledger = new InMemoryIdentityLedger();
  const authority = createConversationAuthority({ sessions: conversations, audit: ledger });
  const producer = createFreshDecisionProducer({
    accounts: stores.accounts,
    sessions: stores.sessions,
    tenants: stores.tenants,
    memberships: stores.memberships,
    workspaces: stores.workspaces,
    workspaceMembers: stores.workspaceMembers,
    conversations,
    catalog,
  });
  await stores.tenants.createTenant({
    tenantId: 'tenant-1',
    slug: 'acme',
    status: 'active',
    createdAt: NOW,
  });
  await stores.accounts.createAccount({
    userId: 'user-1',
    email: 'user-1@example.com',
    accountStatus: 'active',
    globalRole: 'editor',
    createdAt: NOW,
    updatedAt: NOW,
  });
  // Short login session (expires at HALF) under a long conversation (LATER):
  // the expiry classes must stay observable as separate cases.
  await stores.sessions.createSession({
    sessionId: 'sess-1',
    userId: 'user-1',
    status: 'active',
    mfaState: 'none',
    createdAt: NOW,
    expiresAt: HALF,
    refreshCount: 0,
  });
  await stores.workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: null,
    aliases: [],
    enrolledAt: NOW,
  });
  await stores.memberships.upsertMembershipRequest({
    userId: 'user-1',
    tenantId: 'tenant-1',
    status: 'approved',
    tenantRole: 'member',
    decidedBy: 'admin-1',
    decidedAt: NOW,
    updatedAt: NOW,
  });
  await stores.workspaceMembers.putWorkspaceMember({
    workspaceId: 'ws-1',
    userId: 'user-1',
    role: 'editor',
  });
  await authority.openSession(
    { conversationSessionId: 'conv-1', userId: 'user-1', workspaceId: 'ws-1' },
    { now: NOW, ttlSeconds: 3600 },
  );
  return { stores, conversations, authority, ledger, producer };
}

const conversationTurn = {
  inputKind: 'conversation_turn',
  userId: 'user-1',
  workspaceId: 'ws-1',
  conversationSessionId: 'conv-1',
} as const;

describe('fresh decision producer (§2.7 matrix, F15)', () => {
  it('should allow a first-party HTTP request on a live login session', async () => {
    const { producer } = await setup();
    const { decision, allowedTools } = await producer.decide(
      { inputKind: 'first_party_http', userId: 'user-1', workspaceId: 'ws-1', sessionId: 'sess-1' },
      NOW,
    );
    expect(decision).toEqual({
      allow: true,
      sessionAuthority: 'login_session',
      tenantId: 'tenant-1',
      tid: 'acme',
      tenantRole: 'member',
      workspaceRole: 'editor',
      scopes: ['editor', 'tenant:member', 'workspace:editor'],
    });
    expect(allowedTools).toEqual(['mesh.read', 'mesh.write']);
  });

  it('should refuse an HTTP request once the login session expired', async () => {
    const { producer } = await setup();
    const { decision, allowedTools } = await producer.decide(
      { inputKind: 'first_party_http', userId: 'user-1', workspaceId: 'ws-1', sessionId: 'sess-1' },
      HALF,
    );
    expect(decision).toEqual({
      allow: false,
      sessionAuthority: 'login_session',
      reason: 'session_invalid',
    });
    expect(allowedTools).toEqual([]);
  });

  it('should keep a conversation turn running after the login session expired', async () => {
    const { producer } = await setup();
    const { decision, allowedTools } = await producer.decide(conversationTurn, HALF);
    expect(decision).toEqual({
      allow: true,
      sessionAuthority: 'conversation_session',
      tenantId: 'tenant-1',
      tid: 'acme',
      tenantRole: 'member',
      workspaceRole: 'editor',
      scopes: ['editor', 'tenant:member', 'workspace:editor'],
    });
    expect(allowedTools).toEqual(['mesh.read', 'mesh.write']);
  });

  it('should keep a conversation turn running after logout during the turn', async () => {
    const { stores, producer } = await setup();
    await stores.sessions.revokeSession('sess-1', HALF);
    const { decision, allowedTools } = await producer.decide(conversationTurn, HALF);
    expect(decision).toMatchObject({ allow: true, sessionAuthority: 'conversation_session' });
    expect(allowedTools).toEqual(['mesh.read', 'mesh.write']);
  });

  it('should refuse the next turn after the conversation session was revoked', async () => {
    const { authority, producer } = await setup();
    await authority.revokeSession('conv-1', 'admin-1');
    const { decision, allowedTools } = await producer.decide(conversationTurn, HALF);
    expect(decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'session_invalid',
    });
    expect(allowedTools).toEqual([]);
  });

  it('should refuse a conversation turn once the conversation session expired', async () => {
    const { producer } = await setup();
    const { decision, allowedTools } = await producer.decide(conversationTurn, LATER);
    expect(decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'session_invalid',
    });
    expect(allowedTools).toEqual([]);
  });

  it('should empty the tool set on the next call after a mid-session membership suspension', async () => {
    const { stores, producer } = await setup();
    const before = await producer.decide(conversationTurn, HALF);
    expect(before.decision).toMatchObject({ allow: true });
    expect(before.allowedTools).toEqual(['mesh.read', 'mesh.write']);
    await stores.memberships.setMembershipState('user-1', 'tenant-1', {
      status: 'suspended',
      tenantRole: 'member',
      decidedBy: 'admin-1',
      decidedAt: HALF,
      updatedAt: HALF,
    });
    const after = await producer.decide(conversationTurn, HALF);
    expect(after.decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'membership_not_approved',
    });
    expect(after.allowedTools).toEqual([]);
  });

  it('should refuse unbound input kinds with session_authority_unavailable and no tools', async () => {
    const { producer } = await setup();
    const agentPlane = await producer.decide(
      { inputKind: 'agent_plane', userId: 'user-1', workspaceId: 'ws-1', agentSessionId: 'agent-1' },
      NOW,
    );
    expect(agentPlane.decision).toEqual({
      allow: false,
      sessionAuthority: 'agent_session',
      reason: 'session_authority_unavailable',
    });
    expect(agentPlane.allowedTools).toEqual([]);
    const runtimePty = await producer.decide(
      { inputKind: 'runtime_pty', userId: 'user-1', workspaceId: 'ws-1', runtimeRegistrationId: 'runtime-1' },
      NOW,
    );
    expect(runtimePty.decision).toEqual({
      allow: false,
      sessionAuthority: 'runtime_registration',
      reason: 'session_authority_unavailable',
    });
    expect(runtimePty.allowedTools).toEqual([]);
  });

  it('should map refusal reasons through the frozen chain order', async () => {
    const { stores, producer } = await setup();
    await stores.workspaceMembers.removeWorkspaceMember('ws-1', 'user-1');
    const missingMember = await producer.decide(conversationTurn, HALF);
    expect(missingMember.decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'workspace_membership_missing',
    });
    expect(missingMember.allowedTools).toEqual([]);
    await stores.workspaceMembers.putWorkspaceMember({
      workspaceId: 'ws-1',
      userId: 'user-1',
      role: 'viewer',
    });
    await stores.tenants.setTenantStatus('tenant-1', 'suspended', HALF);
    const tenantSuspended = await producer.decide(conversationTurn, HALF);
    expect(tenantSuspended.decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'tenant_not_active',
    });
    expect(tenantSuspended.allowedTools).toEqual([]);
    await stores.tenants.setTenantStatus('tenant-1', 'active', HALF);
    await stores.accounts.setAccountStatus('user-1', 'disabled', HALF);
    const disabled = await producer.decide(conversationTurn, HALF);
    expect(disabled.decision).toEqual({
      allow: false,
      sessionAuthority: 'conversation_session',
      reason: 'account_not_active',
    });
    expect(disabled.allowedTools).toEqual([]);
  });

  it('should size the tool set from the catalog, never partially on refusal', async () => {
    const { producer } = await setup();
    const allowed = await producer.decide(conversationTurn, NOW);
    expect(allowed.allowedTools).toEqual(['mesh.read', 'mesh.write']);
    const unknownConversation = await producer.decide(
      { ...conversationTurn, conversationSessionId: 'conv-ghost' },
      NOW,
    );
    expect(unknownConversation.decision).toMatchObject({
      allow: false,
      reason: 'session_invalid',
    });
    expect(unknownConversation.allowedTools).toEqual([]);
  });
});
