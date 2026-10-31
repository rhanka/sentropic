import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CONTRACT_VERSION,
  IDENTITY_DOMAIN_DESCRIPTORS,
  TenantBoundaryError,
  createFreshDecision,
  createInMemoryDivergenceMetrics,
  createInMemoryIdentityStores,
  createPersonCascade,
  createTenantMemberships,
  createTenantRegistry,
  createTenantResolver,
  createUserAccounts,
  createWorkspaceDirectory,
  identityDomainDescriptor,
  selectIdentityStores,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const CLOCK = () => NOW;

async function approvedSetup() {
  const stores = createInMemoryIdentityStores();
  const accounts = createUserAccounts({ accounts: stores.accounts, audit: stores.audit, clock: CLOCK });
  const registry = createTenantRegistry({
    tenants: stores.tenants,
    memberships: stores.memberships,
    sessions: stores.sessions,
    audit: stores.audit,
    clock: CLOCK,
  });
  const memberships = createTenantMemberships({
    memberships: stores.memberships,
    tenants: stores.tenants,
    audit: stores.audit,
    clock: CLOCK,
  });
  const workspaces = createWorkspaceDirectory({
    workspaces: stores.workspaces,
    members: stores.workspaceMembers,
    audit: stores.audit,
    clock: CLOCK,
  });
  await accounts.register({ userId: 'user-1', email: 'a@example.com' }, { firstAdmin: true });
  await registry.createTenant({ tenantId: 'tenant-1', slug: 'acme' }, 'admin');
  await memberships.requestMembership({ userId: 'user-1', tenantId: 'tenant-1' });
  await memberships.decideMembership({
    userId: 'user-1',
    tenantId: 'tenant-1',
    decision: 'approve',
    actorId: 'admin',
  });
  await workspaces.enrolWorkspace({
    workspaceId: 'ws-1',
    tenantId: 'tenant-1',
    repoIdentity: 'github.com/acme/repo',
    creatorUserId: 'user-1',
  });
  await stores.sessions.createSession({
    sessionId: 's1',
    userId: 'user-1',
    status: 'active',
    mfaState: 'none',
    createdAt: NOW,
    expiresAt: '2026-10-31T12:00:00.000Z',
    refreshCount: 0,
  });
  return { stores, memberships, registry, workspaces };
}

describe('tenant resolution and switch-over modes', () => {
  it('should resolve authoritatively from stores, never from caller input', async () => {
    const { stores } = await approvedSetup();
    const resolver = createTenantResolver({
      workspaces: stores.workspaces,
      tenants: stores.tenants,
      memberships: stores.memberships,
      metrics: createInMemoryDivergenceMetrics(),
    });
    const resolution = await resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'user-1' });
    expect(resolution).toMatchObject({ tid: 'acme', tenantId: 'tenant-1', userId: 'user-1' });
    await expect(
      resolver.resolveAuthoritatively({ workspaceId: 'ws-1', userId: 'user-2' }),
    ).rejects.toBeInstanceOf(TenantBoundaryError);
  });

  it('should compare against the legacy value in shadow without changing behaviour', async () => {
    const { stores } = await approvedSetup();
    const metrics = createInMemoryDivergenceMetrics();
    const resolver = createTenantResolver({
      workspaces: stores.workspaces,
      tenants: stores.tenants,
      memberships: stores.memberships,
      metrics,
    });
    const legacyResolve = async () => 'legacy-tid';
    const same = await resolver.resolveWithMode(
      { workspaceId: 'ws-1', userId: 'user-1' },
      'shadow',
      { legacyResolve: async () => 'acme' },
    );
    expect(same).toMatchObject({ mode: 'shadow', diverged: false, legacyTid: 'acme' });
    const diverged = await resolver.resolveWithMode(
      { workspaceId: 'ws-1', userId: 'user-1' },
      'shadow',
      { legacyResolve },
    );
    expect(diverged).toMatchObject({ mode: 'shadow', diverged: true, legacyTid: 'legacy-tid' });
    expect(diverged.authoritative?.tid).toBe('acme');
    expect(metrics.summary()).toEqual({ samples: 2, diverged: 1 });
  });

  it('should count shadow cases that would fail in strict without throwing', async () => {
    const { stores } = await approvedSetup();
    const metrics = createInMemoryDivergenceMetrics();
    const resolver = createTenantResolver({
      workspaces: stores.workspaces,
      tenants: stores.tenants,
      memberships: stores.memberships,
      metrics,
    });
    const comparison = await resolver.resolveWithMode(
      { workspaceId: 'ws-1', userId: 'user-unknown' },
      'shadow',
      { legacyResolve: async () => 'legacy-tid' },
    );
    expect(comparison).toMatchObject({ mode: 'shadow', diverged: true, authoritative: null });
    await expect(
      resolver.resolveWithMode(
        { workspaceId: 'ws-1', userId: 'user-unknown' },
        'strict',
        { legacyResolve: async () => 'legacy-tid' },
      ),
    ).rejects.toBeInstanceOf(TenantBoundaryError);
  });
});

describe('cascading revocation of a person', () => {
  it('should revoke sessions, suspend memberships and disable the account with receipts', async () => {
    const { stores } = await approvedSetup();
    const cascade = createPersonCascade({
      accounts: stores.accounts,
      sessions: stores.sessions,
      memberships: stores.memberships,
      audit: stores.audit,
      clock: CLOCK,
    });
    const receipt = await cascade.revokePerson('user-1', 'disable', { actorId: 'admin' });
    expect(receipt).toMatchObject({ userId: 'user-1', mode: 'disable' });
    expect(receipt.steps.map((step) => [step.step, step.outcome])).toEqual([
      ['login_sessions', 'applied'],
      ['remote_reader_sessions', 'not_applicable'],
      ['connector_grants', 'not_applicable'],
      ['tenant_memberships', 'applied'],
      ['agent_plane', 'queued'],
      ['purpose_grants', 'not_applicable'],
      ['catalogue', 'not_applicable'],
      ['account', 'applied'],
    ]);
    expect((await stores.accounts.findAccount('user-1'))?.accountStatus).toBe('disabled');
    expect((await stores.sessions.findSession('s1'))?.status).toBe('revoked');
  });

  it('should delete the account in delete mode and close agent sessions through the hook', async () => {
    const { stores } = await approvedSetup();
    const cascade = createPersonCascade({
      accounts: stores.accounts,
      sessions: stores.sessions,
      memberships: stores.memberships,
      agentPlane: { closeAgentSessionsForUser: async () => 2 },
      audit: stores.audit,
      clock: CLOCK,
    });
    const receipt = await cascade.revokePerson('user-1', 'delete', { actorId: 'admin' });
    const agentStep = receipt.steps.find((step) => step.step === 'agent_plane');
    expect(agentStep).toMatchObject({ outcome: 'applied' });
    await expect(stores.accounts.findAccount('user-1')).resolves.toBeNull();
  });
});

describe('fresh authorisation decision per request', () => {
  it('should allow a fully approved subject with intersected scopes', async () => {
    const { stores } = await approvedSetup();
    const decide = createFreshDecision({
      accounts: stores.accounts,
      sessions: stores.sessions,
      tenants: stores.tenants,
      memberships: stores.memberships,
      workspaces: stores.workspaces,
      workspaceMembers: stores.workspaceMembers,
    });
    const verdict = await decide.decide(
      { inputKind: 'first_party_http', userId: 'user-1', workspaceId: 'ws-1', sessionId: 's1' },
      NOW,
    );
    expect(verdict).toMatchObject({
      allow: true,
      sessionAuthority: 'login_session',
      tid: 'acme',
      tenantRole: 'member',
      workspaceRole: 'admin',
    });
  });

  it('should name the session authority per input kind and fail closed on unbound planes', async () => {
    const { stores } = await approvedSetup();
    const decide = createFreshDecision({
      accounts: stores.accounts,
      sessions: stores.sessions,
      tenants: stores.tenants,
      memberships: stores.memberships,
      workspaces: stores.workspaces,
      workspaceMembers: stores.workspaceMembers,
    });
    expect(
      await decide.decide(
        { inputKind: 'conversation_turn', userId: 'user-1', workspaceId: 'ws-1', conversationSessionId: 'chat-1' },
        NOW,
      ),
    ).toEqual({ allow: false, sessionAuthority: 'conversation_session', reason: 'session_authority_unavailable' });
    expect(
      await decide.decide(
        { inputKind: 'agent_plane', userId: 'user-1', workspaceId: 'ws-1', agentSessionId: 'agent-session-1' },
        NOW,
      ),
    ).toEqual({ allow: false, sessionAuthority: 'agent_session', reason: 'session_authority_unavailable' });
    expect(
      await decide.decide(
        { inputKind: 'runtime_pty', userId: 'user-1', workspaceId: 'ws-1', runtimeRegistrationId: 'reg-1' },
        NOW,
      ),
    ).toEqual({
      allow: false,
      sessionAuthority: 'runtime_registration',
      reason: 'session_authority_unavailable',
    });
  });

  it('should refuse with a stable reason when any link is missing', async () => {
    const { stores, memberships } = await approvedSetup();
    const decide = createFreshDecision({
      accounts: stores.accounts,
      sessions: stores.sessions,
      tenants: stores.tenants,
      memberships: stores.memberships,
      workspaces: stores.workspaces,
      workspaceMembers: stores.workspaceMembers,
    });
    await memberships.decideMembership({
      userId: 'user-1',
      tenantId: 'tenant-1',
      decision: 'suspend',
      actorId: 'admin',
    });
    expect(
      await decide.decide(
        { inputKind: 'first_party_http', userId: 'user-1', workspaceId: 'ws-1', sessionId: 's1' },
        NOW,
      ),
    ).toEqual({ allow: false, sessionAuthority: 'login_session', reason: 'membership_not_approved' });
    expect(
      await decide.decide(
        { inputKind: 'first_party_http', userId: 'user-1', workspaceId: 'ws-1', sessionId: 'unknown' },
        NOW,
      ),
    ).toEqual({ allow: false, sessionAuthority: 'login_session', reason: 'session_invalid' });
  });
});

describe('descriptors and persistence profiles', () => {
  it('should describe every identity domain with the contract version', () => {
    expect(IDENTITY_CONTRACT_VERSION).toBe('1.0.0');
    const domains = IDENTITY_DOMAIN_DESCRIPTORS.map((descriptor) => descriptor.domain);
    expect(domains).toEqual(
      expect.arrayContaining([
        'tenants',
        'accounts',
        'proofs',
        'invitations',
        'login_sessions',
        'tenant_memberships',
        'workspaces',
        'resolution',
        'tid_oauth',
        'revocation',
        'decision',
      ]),
    );
    for (const descriptor of IDENTITY_DOMAIN_DESCRIPTORS) {
      expect(descriptor.version).toBe(IDENTITY_CONTRACT_VERSION);
      expect(descriptor.status).toBe('contract-only');
    }
    expect(identityDomainDescriptor('tenants')?.records.length).toBeGreaterThan(0);
    expect(identityDomainDescriptor('unknown' as never)).toBeUndefined();
  });

  it('should select local or durable stores through the binding profile', () => {
    const local = createInMemoryIdentityStores();
    const durable = createInMemoryIdentityStores();
    expect(selectIdentityStores({ mode: 'LOCAL_ONLY', local }).tenants).toBe(local.tenants);
    expect(selectIdentityStores({ mode: 'DURABLE', durable }).tenants).toBe(durable.tenants);
  });
});
