import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

const { mockRefreshClaudeCode } = vi.hoisted(() => ({ mockRefreshClaudeCode: vi.fn() }));
vi.mock('../../src/services/claude-code-provider-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/claude-code-provider-auth')>();
  return { ...original, refreshClaudeCodeAccessToken: (...args: unknown[]) => mockRefreshClaudeCode(...args) };
});

import { db } from '../../src/db/client';
import {
  SEAT_EXTERNAL_POLICY_KEY,
  acquireAntigravityAccountTransport,
  acquireClaudeCodeAccountTransport,
  acquireMistralVibeAccountTransport,
  acquireMuseAccountTransport,
  acquireOpenAICodexAccountTransport,
  importSeatProjection,
  refreshMuseTokenIfNeeded,
  storeClaudeCodeAccountTransport,
  storeCodexAccountTransport,
  storeMistralVibeAccountTransport,
  storeMuseAccountTransport,
  type SeatExternalPolicy,
} from '../../src/services/llm-account-transports';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

const OWNER_SCOPE = 'owner-seat-01';

const codexJwt = (accountId: string, exp?: number): string =>
  `header.${Buffer.from(JSON.stringify({ chatgpt_account_id: accountId, ...(exp !== undefined ? { exp } : {}) }), 'utf8').toString('base64url')}.signature`;

const policy = (overrides: Partial<SeatExternalPolicy> = {}): SeatExternalPolicy => ({
  seatRef: 'seat-synth-01',
  ownerScope: OWNER_SCOPE,
  epoch: 1,
  generation: 1,
  operationId: 'op-synth-01',
  ...overrides,
});

const agyProjection = (overrides = {}) => ({
  cli: 'agy' as const,
  ownerUserId: '',
  expectedOwnerScope: OWNER_SCOPE,
  externalAccountId: 'agy-lab-01',
  accountLabel: 'agy lab',
  accessToken: 'ya29-synth-agy',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  seatPolicy: policy(),
  billingClear: true,
  packageProviderId: 'cloud-code',
  packageAccountTransport: 'cloud-code',
  requestedTargetProviderId: 'cloudcode-pa',
  requestedTransportProviderId: 'antigravity',
  issuingClientRef: 'client-synth-agy-01',
  endpointFamily: 'endpoint-synth-agy-01',
  project: 'proj-synth-01',
  ...overrides,
});

const claudeProjection = (overrides = {}) => ({
  cli: 'claude' as const,
  ownerUserId: '',
  expectedOwnerScope: OWNER_SCOPE,
  externalAccountId: 'claude-lab-01',
  accountLabel: 'claude lab',
  accessToken: 'sk-ant-synth-claude',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  seatPolicy: policy({ seatRef: 'seat-synth-claude-01' }),
  billingClear: true,
  ...overrides,
});

const rowCount = async (ownerUserId: string): Promise<number> => {
  const rows = await db.all<{ count: number }>(sql`
    SELECT count(*)::integer AS count FROM llm_provider_accounts WHERE owner_user_id = ${ownerUserId}
  `);
  return rows[0]?.count ?? 0;
};

const accountRow = async (ownerUserId: string, externalAccountId: string) => {
  const rows = await db.all<{ token_secret: string | null; last_error: string | null; status: string; metadata: unknown }>(sql`
    SELECT token_secret, last_error, status, metadata FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId} AND external_account_id = ${externalAccountId}
  `);
  return rows[0];
};

const markExternal = async (ownerUserId: string, externalAccountId: string, seatRef: string) => {
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({ [SEAT_EXTERNAL_POLICY_KEY]: policy({ seatRef }) })}::jsonb
    WHERE owner_user_id = ${ownerUserId} AND external_account_id = ${externalAccountId}
  `);
};

describe('llm seat projection import', () => {
  afterEach(async () => {
    mockRefreshClaudeCode.mockReset();
    await cleanupAuthData();
  });

  it('accepts the exact agy package cloud-code to antigravity/cloudcode-pa tuple', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const stored = await importSeatProjection({ ...agyProjection(), ownerUserId: user.id });
    expect(stored).not.toBeNull();

    const acquired = await acquireAntigravityAccountTransport({
      userId: user.id,
      modelId: 'gemini-3-pro-high',
      requestId: 'seat-agy-1',
    });
    expect(acquired?.accessToken).toBe('ya29-synth-agy');
    expect(acquired?.refreshToken).toBeNull();
    expect(acquired?.transportProviderId).toBe('antigravity');
    const metadata = acquired?.metadata as Record<string, unknown> | null;
    expect(metadata?.['productAccountSource']).toBe('antigravity');
    expect(metadata?.[SEAT_EXTERNAL_POLICY_KEY]).toMatchObject({ seatRef: 'seat-synth-01' });
    await acquired?.recordOutcome({ status: 'success' });
  });

  it('accepts a refresh-less Claude projection and serves it without renewal', async () => {
    const user = await createAuthenticatedUser('admin_app');
    expect(await importSeatProjection({ ...claudeProjection(), ownerUserId: user.id })).not.toBeNull();

    const acquired = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      requestId: 'seat-claude-1',
    });
    expect(acquired?.accessToken).toBe('sk-ant-synth-claude');
    expect(acquired?.refreshToken).toBeNull();
    await acquired?.recordOutcome({ status: 'success' });
  });

  it.each([
    ['gemini target', { requestedTargetProviderId: 'gemini' }],
    ['application cloud-code transport', { requestedTransportProviderId: 'cloud-code' }],
    ['mixed tuple', { requestedTargetProviderId: 'gemini', requestedTransportProviderId: 'cloud-code' }],
    ['wrong package provider', { packageProviderId: 'antigravity' }],
    ['wrong package transport', { packageAccountTransport: 'antigravity' }],
    ['wrong client', { issuingClientRef: '' }],
    ['wrong endpoint', { endpointFamily: '' }],
    ['owner scope mismatch', { expectedOwnerScope: 'owner-other-01' }],
    ['missing billing clearance', { billingClear: false }],
  ])('refuses an agy projection with %s and writes nothing', async (_label, overrides) => {
    const user = await createAuthenticatedUser('admin_app');
    const before = await rowCount(user.id);
    expect(await importSeatProjection({ ...agyProjection(), ownerUserId: user.id, ...overrides })).toBeNull();
    expect(await rowCount(user.id)).toBe(before);
  });

  it('refuses a refresh-bearing projection with zero writes', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const before = await rowCount(user.id);
    expect(
      await importSeatProjection({
        ...claudeProjection(),
        ownerUserId: user.id,
        refreshToken: 'smuggled-refresh',
      } as Parameters<typeof importSeatProjection>[0] & { refreshToken: string }),
    ).toBeNull();
    expect(await rowCount(user.id)).toBe(before);
  });

  it('classifies expired external access as unavailable and retains the secret', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await importSeatProjection({
      ...claudeProjection(),
      ownerUserId: user.id,
      accessToken: 'sk-ant-stale',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const acquired = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      requestId: 'seat-claude-expired',
    });
    expect(acquired).toBeNull();
    const row = await accountRow(user.id, 'claude-lab-01');
    expect(row?.token_secret).not.toBeNull();
    expect(row?.last_error).toContain('access-unavailable');
    expect(row?.status).toBe('active');
  });

  it('preserves the renewable 401 path while external seats never reach the provider', async () => {
    const renewable = await createAuthenticatedUser('admin_app');
    mockRefreshClaudeCode.mockRejectedValueOnce(new Error('Claude Code token refresh failed (401).'));
    await storeClaudeCodeAccountTransport({
      ownerUserId: renewable.id,
      externalAccountId: 'claude-renewable-01',
      accessToken: 'claude-renewable-access',
      refreshToken: 'claude-renewable-refresh',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(
      await acquireClaudeCodeAccountTransport({ userId: renewable.id, modelId: 'claude-sonnet-4-6' }),
    ).toBeNull();
    expect(mockRefreshClaudeCode).toHaveBeenCalledTimes(1);
    const renewableRow = await accountRow(renewable.id, 'claude-renewable-01');
    expect(renewableRow?.status).toBe('reauth_required');

    const user = await createAuthenticatedUser('admin_app');
    mockRefreshClaudeCode.mockClear();
    await importSeatProjection({
      ...claudeProjection(),
      ownerUserId: user.id,
      accessToken: 'sk-ant-stale',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(
      await acquireClaudeCodeAccountTransport({ userId: user.id, modelId: 'claude-sonnet-4-6' }),
    ).toBeNull();
    expect(mockRefreshClaudeCode).not.toHaveBeenCalled();
    const row = await accountRow(user.id, 'claude-lab-01');
    expect(row?.token_secret).not.toBeNull();
    expect(row?.status).toBe('active');
    expect(row?.last_error).toContain('access-unavailable');
  });

  it('recovers on a newer projection without account duplication', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await importSeatProjection({ ...claudeProjection(), ownerUserId: user.id });
    await importSeatProjection({
      ...claudeProjection(),
      ownerUserId: user.id,
      accessToken: 'sk-ant-rotated',
      seatPolicy: policy({ seatRef: 'seat-synth-claude-01', generation: 2, operationId: 'op-synth-02' }),
    });
    expect(await rowCount(user.id)).toBe(1);
    const acquired = await acquireClaudeCodeAccountTransport({
      userId: user.id,
      modelId: 'claude-sonnet-4-6',
      requestId: 'seat-claude-n2',
    });
    expect(acquired?.accessToken).toBe('sk-ant-rotated');
    await acquired?.recordOutcome({ status: 'success' });
  });

  it('refuses acquisition by another owner', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const other = await createAuthenticatedUser('admin_app');
    await importSeatProjection({ ...agyProjection(), ownerUserId: user.id });
    const acquired = await acquireAntigravityAccountTransport({
      userId: other.id,
      modelId: 'gemini-3-pro-high',
      requestId: 'seat-agy-other',
    });
    expect(acquired).toBeNull();
  });

  it('guards externally marked Codex rows through the real acquisition', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const accessToken = codexJwt('codex-lab-01', Math.floor(Date.now() / 1000) + 3600);
    await storeCodexAccountTransport({ ownerUserId: user.id, accessToken });
    await markExternal(user.id, 'codex-lab-01', 'seat-synth-codex-01');
    const acquired = await acquireOpenAICodexAccountTransport({
      userId: user.id,
      modelId: 'gpt-5.5',
      requestId: 'seat-codex-1',
    });
    expect(acquired?.accessToken).toBe(accessToken);
    await acquired?.recordOutcome({ status: 'success' });
  });

  it('treats an external Codex row with unknown expiry as unavailable, never served', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await storeCodexAccountTransport({ ownerUserId: user.id, accessToken: codexJwt('codex-lab-01') });
    await markExternal(user.id, 'codex-lab-01', 'seat-synth-codex-01');
    const acquired = await acquireOpenAICodexAccountTransport({
      userId: user.id,
      modelId: 'gpt-5.5',
      requestId: 'seat-codex-unknown-expiry',
    });
    expect(acquired).toBeNull();
    const row = await accountRow(user.id, 'codex-lab-01');
    expect(row?.token_secret).not.toBeNull();
    expect(row?.last_error).toContain('access-unavailable');
    expect(row?.status).toBe('active');
  });

  it('never wipes an expired externally marked Codex secret', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await storeCodexAccountTransport({
      ownerUserId: user.id,
      accessToken: codexJwt('codex-lab-01', Math.floor(Date.now() / 1000) - 3600),
    });
    await markExternal(user.id, 'codex-lab-01', 'seat-synth-codex-01');
    const acquired = await acquireOpenAICodexAccountTransport({
      userId: user.id,
      modelId: 'gpt-5.5',
      requestId: 'seat-codex-expired',
    });
    expect(acquired).toBeNull();
    const row = await accountRow(user.id, 'codex-lab-01');
    expect(row?.token_secret).not.toBeNull();
    expect(row?.last_error).toContain('access-unavailable');
    expect(row?.status).toBe('active');
  });

  it('never renews or wipes an expired externally marked Muse row', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await storeMuseAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'muse-lab-02',
      accessToken: 'muse-stale',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await markExternal(user.id, 'muse-lab-02', 'seat-synth-muse-02');
    const acquired = await acquireMuseAccountTransport({
      userId: user.id,
      modelId: 'muse-spark-1.3-contributor',
      requestId: 'seat-muse-expired',
    });
    expect(acquired).toBeNull();
    const row = await accountRow(user.id, 'muse-lab-02');
    expect(row?.token_secret).not.toBeNull();
    expect(row?.status).toBe('active');
    expect(row?.last_error).toContain('access-unavailable');
  });

  it('refuses CLI-store re-reads for policy-marked Muse tokens without touching disk', async () => {
    const readAuthFile = vi.fn(async (_path: string) => '{}');
    const refused = await refreshMuseTokenIfNeeded(
      {
        accountId: 'acct-muse-seat-01',
        token: {
          accessToken: 'muse-access',
          refreshToken: null,
          tokenType: 'bearer',
          obtainedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          source: 'muse-import',
          apiBaseUrl: null,
          accountEmail: null,
          externalSeatPolicy: policy({ seatRef: 'seat-synth-muse-01' }),
        },
      },
      readAuthFile,
    );
    expect(refused).toBeNull();
    expect(readAuthFile).not.toHaveBeenCalled();
  });

  it('serves an externally marked Muse row without re-reading the CLI store', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await storeMuseAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'muse-lab-01',
      accessToken: 'muse-access',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await markExternal(user.id, 'muse-lab-01', 'seat-synth-muse-01');
    const acquired = await acquireMuseAccountTransport({
      userId: user.id,
      modelId: 'muse-spark-1.3-contributor',
      requestId: 'seat-muse-1',
    });
    expect(acquired?.accessToken).toBe('muse-access');
    await acquired?.recordOutcome({ status: 'success' });
  });

  it('keeps the Vibe non-destructive expiry behavior as regression', async () => {
    const user = await createAuthenticatedUser('admin_app');
    await storeMistralVibeAccountTransport({
      ownerUserId: user.id,
      externalAccountId: 'vibe-lab-01',
      accessToken: 'vibe-key',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const acquired = await acquireMistralVibeAccountTransport({
      userId: user.id,
      modelId: 'mistral-large-4',
      requestId: 'seat-vibe-expired',
    });
    expect(acquired).toBeNull();
    const row = await accountRow(user.id, 'vibe-lab-01');
    expect(row?.token_secret).not.toBeNull();
  });
});
