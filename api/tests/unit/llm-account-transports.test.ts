import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

import { db } from '../../src/db/client';
import {
  fetchClaudeCodeProfile,
  refreshClaudeCodeAccessToken,
} from '../../src/services/claude-code-provider-auth';
import {
  acquireAntigravityAccountTransport,
  acquireClaudeCodeAccountTransport,
  acquireCloudCodeAccountTransport,
  getPrimaryCloudCodeAccountTransport,
  inferCodexAccountIdFromToken,
  inferTokenExpiresAt,
  storeAntigravityAccountTransport,
  storeClaudeCodeAccountTransport,
  storeCloudCodeAccountTransport,
} from '../../src/services/llm-account-transports';
import {
  getAnthropicTransportMode,
  setAnthropicTransportMode,
} from '../../src/services/provider-connections';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

const jwtWithPayload = (payload: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;

describe('llm account transports', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.run(sql`DELETE FROM settings WHERE key = 'provider_connection_mode:anthropic'`);
    await cleanupAuthData();
  });

  it('infers Codex account ids from access token claims', () => {
    const accessToken = jwtWithPayload({
      chatgpt_account_id: 'acct_codex_123',
      exp: 1_800_000_000,
    });

    expect(inferCodexAccountIdFromToken(accessToken, null)).toBe('acct_codex_123');
  });

  it('falls back to OpenAI auth and organization claims', () => {
    const accessToken = jwtWithPayload({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_auth_claim',
      },
    });
    const orgToken = jwtWithPayload({
      organizations: [{ id: 'org_fallback' }],
    });

    expect(inferCodexAccountIdFromToken(accessToken, null)).toBe('acct_auth_claim');
    expect(inferCodexAccountIdFromToken(jwtWithPayload({}), orgToken)).toBe('org_fallback');
  });

  it('infers token expiry from JWT exp claims', () => {
    const accessToken = jwtWithPayload({ exp: 1_800_000_000 });

    expect(inferTokenExpiresAt(accessToken, null)).toBe('2027-01-15T08:00:00.000Z');
  });

  it('refreshes Claude Code OAuth with the Claude Code client contract', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({
        access_token: 'new-claude-access',
        refresh_token: 'new-claude-refresh',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const refreshed = await refreshClaudeCodeAccessToken({
      refreshToken: 'old-claude-refresh',
    });

    expect(refreshed.accessToken).toBe('new-claude-access');
    expect(refreshed.refreshToken).toBe('new-claude-refresh');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://platform.claude.com/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"grant_type":"refresh_token"'),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      refresh_token: 'old-claude-refresh',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    });
  });

  it('fetches Claude Code profile identity with bearer auth', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({
        account: {
          uuid: 'claude-account-123',
          email: 'claude@example.com',
          display_name: 'Claude Account',
          has_claude_max: true,
          has_claude_pro: false,
        },
        organization: {
          name: 'Claude Org',
          organization_type: 'team',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await fetchClaudeCodeProfile({ accessToken: 'claude-access' });

    expect(profile).toMatchObject({
      accountUuid: 'claude-account-123',
      email: 'claude@example.com',
      orgName: 'Claude Org',
      orgType: 'team',
      hasClaudeMax: true,
      hasClaudePro: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/api/oauth/profile',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer claude-access',
        },
      }),
    );
  });

  it('requires explicit Anthropic transport mode for Claude Code routing policy', async () => {
    expect(await getAnthropicTransportMode()).toBe('token');

    await setAnthropicTransportMode('claude-code');

    expect(await getAnthropicTransportMode()).toBe('claude-code');
  });

  it('acquires multiple Claude Code accounts with sticky affinity and cooldown failover', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await storeClaudeCodeAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'claude-a',
      accountLabel: 'Claude A',
      accessToken: 'claude-access-a',
      refreshToken: 'claude-refresh-a',
      expiresAt,
    });
    await storeClaudeCodeAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'claude-b',
      accountLabel: 'Claude B',
      accessToken: 'claude-access-b',
      refreshToken: 'claude-refresh-b',
      expiresAt,
    });

    const first = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      affinityKey: 'chat_session:a',
      requestId: 'req-a-1',
    });
    expect(first?.transportProviderId).toBe('claude-code');
    expect(first?.accessToken).toBe('claude-access-a');
    await first?.recordOutcome({ status: 'success' });

    const sameSession = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      affinityKey: 'chat_session:a',
      requestId: 'req-a-2',
    });
    expect(sameSession?.accountTransportAccountId).toBe(first?.accountTransportAccountId);
    expect(sameSession?.stableSessionId).toBe(first?.stableSessionId);
    await sameSession?.recordOutcome({ status: 'rate_limited', retryAfterMs: 60_000 });

    const newSession = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      affinityKey: 'chat_session:b',
      requestId: 'req-b-1',
    });
    expect(newSession?.accountTransportAccountId).not.toBe(first?.accountTransportAccountId);
    expect(newSession?.accessToken).toBe('claude-access-b');
    await newSession?.recordOutcome({ status: 'success' });
  });

  it('acquires an antigravity account carrying its bound project, disjoint from claude-code', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await storeAntigravityAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'antigravity-sub-1',
      accountLabel: 'Antigravity Fabien',
      accessToken: 'ya29-antigravity',
      refreshToken: 'refresh-antigravity',
      expiresAt,
      project: 'proj-antigravity-123',
    });

    const acquired = await acquireAntigravityAccountTransport({
      userId: user.id,
      modelId: 'gemini-3-pro-high',
      requestId: 'antigravity-req-1',
    });
    expect(acquired?.transportProviderId).toBe('antigravity');
    expect(acquired?.accessToken).toBe('ya29-antigravity');
    expect((acquired?.metadata as Record<string, unknown> | null)?.project).toBe('proj-antigravity-123');
    await acquired?.recordOutcome({ status: 'success' });

    // Pool disjointness: a claude-code acquire can NEVER pick the antigravity
    // account (selection keyed by target `cloudcode-pa` + transport `antigravity`).
    const claudeAcquire = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      requestId: 'antigravity-req-2',
    });
    expect(claudeAcquire).toBeNull();
  });

  it('stores and acquires Cloud Code account transport with multi-tenant userId isolation and project metadata', async () => {
    const user1 = await createAuthenticatedUser('admin_app');
    const user2 = await createAuthenticatedUser('admin_app');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // Store Cloud Code account for user1
    await storeCloudCodeAccountTransport({
      ownerUserId: user1.id,
      externalAccountId: 'cc-user1-account',
      accountLabel: 'Cloud Code User 1',
      accessToken: 'cc-access-user1',
      refreshToken: 'cc-refresh-user1',
      expiresAt,
      cloudaicompanionProject: 'user1-cloudcode-project',
    });

    const primary1 = await getPrimaryCloudCodeAccountTransport({ ownerUserId: user1.id });
    expect(primary1).not.toBeNull();
    expect(primary1?.transportProviderId).toBe('cloud-code');

    // User 2 should NOT acquire user 1's account (multi-tenant isolation)
    const acqUser2 = await acquireCloudCodeAccountTransport({
      userId: user2.id,
      modelId: 'gemini-2.5-flash',
      affinityKey: 'session:user2',
    });
    expect(acqUser2).toBeNull();

    // User 1 acquires their Cloud Code account
    const acqUser1 = await acquireCloudCodeAccountTransport({
      userId: user1.id,
      modelId: 'gemini-2.5-flash',
      affinityKey: 'session:user1',
    });
    expect(acqUser1).not.toBeNull();
    expect(acqUser1?.accessToken).toBe('cc-access-user1');
    expect(acqUser1?.transportProviderId).toBe('cloud-code');
    expect(acqUser1?.metadata).toMatchObject({
      cloudaicompanionProject: 'user1-cloudcode-project',
    });
  });
});
