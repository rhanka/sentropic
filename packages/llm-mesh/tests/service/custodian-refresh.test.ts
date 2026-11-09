import { describe, expect, it, vi } from 'vitest';
import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { ClaudeRefreshPreparationError } from '../../src/enrollment/claude-code.js';
import { MusePostRotationError } from '../../src/enrollment/muse-code.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import type { CustodianRefreshReport } from '../../src/service/custodian-refresh.js';
import type { KeyringAdapter } from '../../src/service/facade.js';
import type { ReauthAlertEvent } from '../../src/service/reauth-alert.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
import { markExternalSeatAuthority } from '../../src/service/external-seat-authority.js';

const MINUTE = 60_000;
// Fixed origin: every custody decision reads the injected clock, so stubbed
// expiries derive from the same clock and the suite never touches wall time.
const T0 = 1_750_000_000_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const stubProvider = (behavior: 'ok' | 'fail', nowRef: { current: number }) => {
  const refresh = vi.fn(async (input: { accountId: string }) => {
    if (behavior === 'fail') throw new Error('provider refresh failed');
    return { accountId: input.accountId, accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh', expiresAt: iso(nowRef.current + 24 * 60 * MINUTE),
      authClientConfigVersion: 'v1.0.0' };
  });
  return { provider: { refresh } as unknown as EnrollmentProvider, refresh };
};

const seed = (service: LocalAccountTransportService, input: { accountId: string;
  ownerScopeRef: string; refreshToken?: string | null; expiresAt?: string | null;
  enrollmentCompletedAt?: string; external?: boolean; transportProviderId?: 'cloud-code' | 'muse';
  metadata?: Record<string, unknown> }): void => {
  service.registerAccount({ accountId: input.accountId, ownerScopeRef: input.ownerScopeRef,
    accountLabel: `${input.ownerScopeRef} label`, targetProviderId: 'openai' as const,
    transportProviderId: (input.transportProviderId ?? 'cloud-code') as const, accessToken: 'old-access',
    ...(input.refreshToken === undefined ? {} : { refreshToken: input.refreshToken }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }), status: 'active',
    ...(input.enrollmentCompletedAt ? { enrollmentCompletedAt: input.enrollmentCompletedAt } : {}),
    ...(input.external ? { metadata: markExternalSeatAuthority(undefined, { seatRef: 'seat-1',
      ownerScope: input.ownerScopeRef, epoch: 1, generation: 1, operationId: 'op-test-1' }) }
      : (input.metadata ? { metadata: input.metadata } : {})),
  });
};

const makeService = (behavior: 'ok' | 'fail', now: number, alerts: ReauthAlertEvent[]) => {
  const nowRef = { current: now };
  const { provider, refresh } = stubProvider(behavior, nowRef);
  const service = new LocalAccountTransportService(new InMemoryKeyring(),
    new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
    { now: () => nowRef.current, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
  return { service, refresh };
};

const failWith = (failure: unknown, now: number, alerts: ReauthAlertEvent[]) => {
  const refresh = vi.fn(async () => { throw failure; });
  const provider = { refresh } as unknown as EnrollmentProvider;
  const service = new LocalAccountTransportService(new InMemoryKeyring(),
    new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
    { now: () => now, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
  return { service, refresh };
};

describe('runCustodianRefreshCycle', () => {
  it('should refresh before expiry under an injected clock', async () => {
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0 + 50 * MINUTE, alerts);
    seed(service, { accountId: 'acct-early', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-1', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.refreshed).toBe(1);
    expect(report.accounts[0]).toMatchObject({ action: 'refreshed', readiness: 'ready' });
    expect(alerts).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('grant-1');
    const { service: idleService, refresh: idleRefresh } = makeService('ok', T0, []);
    seed(idleService, { accountId: 'acct-fresh', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 600 * MINUTE), refreshToken: 'grant-9', enrollmentCompletedAt: iso(T0) });
    const idle = await idleService.runCustodianRefreshCycle();
    expect(idle.accounts[0].action).toBe('skipped-healthy');
    expect(idleRefresh).not.toHaveBeenCalled();
  });

  it('should emit a secret-free reauth alert on refresh failure without a business call', async () => {
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('fail', T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-flaky', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-2', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ownerScopeRef: 'owner',
      transportProviderId: 'cloud-code', reason: 'refresh-failed' });
    expect(JSON.stringify(alerts)).not.toContain('grant-2');
    expect(JSON.stringify(alerts)).not.toContain('acct-flaky');
    const eligible = await service.createRouteDirectory({} as never)
      .listEligible({ principalRef: 'owner', ownerScopeRef: 'owner' });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].readiness).toBe('reauth-required');
    const encore = await service.runCustodianRefreshCycle();
    expect(encore.accounts[0].action).toBe('already-reauth');
    expect(alerts).toHaveLength(1);
  });

  it('should keep two same-transport accounts isolated by owner', async () => {
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0 + 50 * MINUTE, alerts);
    seed(service, { accountId: 'acct-owner-a', ownerScopeRef: 'owner-a',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-a', enrollmentCompletedAt: iso(T0) });
    seed(service, { accountId: 'acct-owner-b', ownerScopeRef: 'owner-b',
      expiresAt: iso(T0 + 600 * MINUTE), refreshToken: 'grant-b', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toMatchObject({ accountId: 'acct-owner-a' });
    expect(report.accounts).toHaveLength(2);
    expect(report.accounts.find((entry) => entry.ownerScopeRef === 'owner-a')?.action).toBe('refreshed');
    expect(report.accounts.find((entry) => entry.ownerScopeRef === 'owner-b')?.action).toBe('skipped-healthy');
    expect(alerts).toEqual([]);
  });

  it('should not refresh every tick for a long-enrolled account with a fresh credential', async () => {
    // B1: the window must restart at each credential issuance. An account
    // enrolled 3h ago whose current credential lives 60 minutes opens a
    // 15-minute window, not a 60-minute one derived from the enrollment age.
    const nowRef = { current: T0 };
    const refresh = vi.fn(async (input: { accountId: string }) => ({
      accountId: input.accountId, accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh', expiresAt: iso(nowRef.current + 60 * MINUTE),
      authClientConfigVersion: 'v1.0.0',
    }));
    const provider = { refresh } as unknown as EnrollmentProvider;
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => nowRef.current, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-aged', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 5 * MINUTE), refreshToken: 'grant-aged',
      enrollmentCompletedAt: iso(T0 - 180 * MINUTE) });
    const first = await service.runCustodianRefreshCycle();
    expect(first.accounts[0]).toMatchObject({ action: 'refreshed', readiness: 'ready' });
    expect(refresh).toHaveBeenCalledTimes(1);
    nowRef.current = T0 + 30 * MINUTE;
    const second = await service.runCustodianRefreshCycle();
    expect(second.accounts[0]).toMatchObject({ action: 'skipped-healthy', readiness: 'ready' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(alerts).toEqual([]);
  });

  it('should skip external seats and static keys without a refresh grant', async () => {
    const { service, refresh } = makeService('ok', T0, []);
    seed(service, { accountId: 'acct-external', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + MINUTE), refreshToken: 'grant-ext',
      enrollmentCompletedAt: iso(T0 - 60 * MINUTE), external: true });
    seed(service, { accountId: 'acct-static', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 365 * 24 * 60 * MINUTE), refreshToken: null,
      enrollmentCompletedAt: iso(T0 - 60 * MINUTE) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).not.toHaveBeenCalled();
    expect(report.accounts.map((entry) => entry.action).sort()).toEqual(
      ['skipped-external', 'skipped-no-grant']);
  });

  it('should alert again on the next outage after the owner re-enrolls', async () => {
    // B2: the alert epoch must not survive a re-enrollment, or the second
    // outage after an owner re-auth stays silent forever.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('fail', T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-reauth', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-1', enrollmentCompletedAt: iso(T0) });
    const first = await service.runCustodianRefreshCycle();
    expect(first.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    // The owner re-authenticates: the enrollment re-registers the account.
    seed(service, { accountId: 'acct-reauth', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-2', enrollmentCompletedAt: iso(T0) });
    const second = await service.runCustodianRefreshCycle();
    expect(second.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(alerts).toHaveLength(2);
  });

  it('should flip and alert when an account without a refresh grant expires', async () => {
    // B3: a grant-less credential cannot recover on its own; expiry must
    // flip the status and alert for a planned re-enrollment.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0 + 120 * MINUTE, alerts);
    seed(service, { accountId: 'acct-nogrant', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: null, enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'expired-no-grant', readiness: 'reauth-required' });
    expect(refresh).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ ownerScopeRef: 'owner', reason: 'expired-no-grant' });
    const encore = await service.runCustodianRefreshCycle();
    expect(encore.accounts[0].action).toBe('already-reauth');
    expect(alerts).toHaveLength(1);
    const eligible = await service.createRouteDirectory({} as never)
      .listEligible({ principalRef: 'owner', ownerScopeRef: 'owner' });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].readiness).toBe('reauth-required');
  });

  it('should refresh a CLI-imported Muse account through the cycle instead of flipping', async () => {
    // B3 (r2): the Muse CLI import stores no refresh grant, but the
    // credential IS renewable — the provider re-reads the CLI store and
    // re-mints. An expired CLI account must refresh like a grant account,
    // not freeze in reauth_required.
    const nowRef = { current: T0 };
    const museRefresh = vi.fn(async (input: { accountId: string }) => ({
      accountId: input.accountId, accessToken: 'minted-cli-key',
      expiresAt: iso(nowRef.current + 60 * MINUTE), authClientConfigVersion: '1',
    }));
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['muse', { refresh: museRefresh } as unknown as EnrollmentProvider]]),
      { async resolveConfig() { return {}; } }, undefined,
      { now: () => nowRef.current, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    // Expired past the skew window: the old code flipped grant-less
    // accounts before any provider call.
    seed(service, { accountId: 'acct-muse-cli', ownerScopeRef: 'owner',
      transportProviderId: 'muse', expiresAt: iso(T0 - MINUTE),
      enrollmentCompletedAt: iso(T0 - 120 * MINUTE) });
    nowRef.current = T0;
    const report = await service.runCustodianRefreshCycle();
    expect(museRefresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject({ action: 'refreshed', readiness: 'ready' });
    expect(alerts).toEqual([]);
    const eligible = await service.createRouteDirectory({} as never)
      .listEligible({ principalRef: 'owner', ownerScopeRef: 'owner' });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].readiness).toBe('ready');
  });

  it('should still flip a direct-billed Muse key with no grant on expiry', async () => {
    // B3 (r2): a direct API key has no CLI store to re-read
    // (`auth_type: 'api_key'`) — only re-import rotates it. It keeps the
    // grant-less flip, and the provider is never called.
    const museRefresh = vi.fn(async (input: { accountId: string }) => ({
      accountId: input.accountId, accessToken: 'minted-cli-key',
      expiresAt: iso(T0 + 60 * MINUTE), authClientConfigVersion: 'direct-api-key-v1',
    }));
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['muse', { refresh: museRefresh } as unknown as EnrollmentProvider]]),
      { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 120 * MINUTE, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-muse-direct', ownerScopeRef: 'owner',
      transportProviderId: 'muse', expiresAt: iso(T0 + 60 * MINUTE),
      enrollmentCompletedAt: iso(T0),
      metadata: { billing_type: 'direct', auth_type: 'api_key' } });
    const report = await service.runCustodianRefreshCycle();
    expect(museRefresh).not.toHaveBeenCalled();
    expect(report.accounts[0]).toMatchObject(
      { action: 'expired-no-grant', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'expired-no-grant' });
  });

  it('should warn once before a grant-less expiry and still alert on the flip', async () => {
    // B3-partial (r2): a grant-less credential gets no refresh, so the
    // expiry flip alone leaves no plannable window. Inside the refresh
    // window the cycle warns once (`expiring-no-grant`, upcoming expiry in
    // the report) on its own epoch; the later expiry flip still alerts.
    const nowRef = { current: T0 };
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', { refresh: vi.fn() } as unknown as EnrollmentProvider]]),
      { async resolveConfig() { return {}; } }, undefined,
      { now: () => nowRef.current, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    // TTL 60 min from issuance, expiry in 5 min: remaining (5) <= window
    // (min(60, max(10, 15)) = 15), so the warning fires.
    seed(service, { accountId: 'acct-warn', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 5 * MINUTE), refreshToken: null, enrollmentCompletedAt: iso(T0 - 55 * MINUTE) });
    // Far-future static key: no warning, expiry exposed for planning.
    seed(service, { accountId: 'acct-far', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 365 * 24 * 60 * MINUTE), refreshToken: null,
      enrollmentCompletedAt: iso(T0 - 55 * MINUTE) });
    const first = await service.runCustodianRefreshCycle();
    expect(first.accounts).toHaveLength(2);
    const warned = first.accounts.find((entry) => entry.expiresAt === iso(T0 + 5 * MINUTE));
    expect(warned).toMatchObject({ action: 'skipped-no-grant', readiness: 'ready' });
    const far = first.accounts.find((entry) => entry.expiresAt === iso(T0 + 365 * 24 * 60 * MINUTE));
    expect(far).toMatchObject({ action: 'skipped-no-grant', readiness: 'ready' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'expiring-no-grant', expiresAt: iso(T0 + 5 * MINUTE) });
    expect(JSON.stringify(alerts)).not.toContain('acct-warn');
    // A second cycle in the window does not warn again.
    const second = await service.runCustodianRefreshCycle();
    expect(second.accounts.find((entry) => entry.expiresAt === iso(T0 + 5 * MINUTE)))
      .toMatchObject({ action: 'skipped-no-grant', readiness: 'ready' });
    expect(alerts).toHaveLength(1);
    // Past expiry the account flips and alerts on the separate flip epoch.
    nowRef.current = T0 + 10 * MINUTE;
    const third = await service.runCustodianRefreshCycle();
    expect(third.accounts.find((entry) => entry.action === 'expired-no-grant'))
      .toMatchObject({ readiness: 'reauth-required' });
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({ reason: 'expired-no-grant' });
  });

  it('should read reauth-required for an external seat with unknown expiry', async () => {
    // M4 (r2): the seat import stores `''` for an unknown provider expiry,
    // and unknown is not infinite validity. The report reads not-ready —
    // like the route directory — without flipping or alerting.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0, alerts);
    seed(service, { accountId: 'acct-ext-unknown', ownerScopeRef: 'owner',
      expiresAt: null, refreshToken: null, enrollmentCompletedAt: iso(T0), external: true });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'skipped-external', readiness: 'reauth-required' });
    expect(report.accounts[0]).not.toHaveProperty('expiredAt');
    expect(refresh).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('should read not-ready for a grant-holding account with no usable expiry', async () => {
    // M4 (r2): without an expiry the custodian cannot schedule a renewal,
    // so the account must not be reported ready. No flip: routing still
    // serves the live credential until a real failure.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0, alerts);
    seed(service, { accountId: 'acct-noexpiry', ownerScopeRef: 'owner',
      expiresAt: null, refreshToken: 'grant-nx', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'skipped-no-expiry', readiness: 'reauth-required' });
    expect(refresh).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('should defer without flipping on a transient provider failure', async () => {
    // M1: an explicit 503 means the grant was not consumed. The account
    // must stay active with no owner alert; the next tick retries.
    const refresh = vi.fn(async () => {
      throw new Error('Cloud Code token refresh failed (503): Service Unavailable');
    });
    const provider = { refresh } as unknown as EnrollmentProvider;
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 55 * MINUTE, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-transient', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-t', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-deferred-retry', readiness: 'ready' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(alerts).toEqual([]);
    const eligible = await service.createRouteDirectory({} as never)
      .listEligible({ principalRef: 'owner', ownerScopeRef: 'owner' });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].readiness).toBe('ready');
  });

  it('should flip on an explicit invalid_grant revocation', async () => {
    // M1: a revoked grant is definitive — flip early and alert, no retry.
    const refresh = vi.fn(async () => {
      throw new Error('Codex token refresh failed (400): {"error":"invalid_grant","reason":"revoked"}');
    });
    const provider = { refresh } as unknown as EnrollmentProvider;
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 55 * MINUTE, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-revoked', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-dead', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should defer without flipping on a preparation failure', async () => {
    // M1: no provider request went out, so the report must not claim a
    // reauth that routing denies.
    const refresh = vi.fn(async () => {
      throw new ClaudeRefreshPreparationError();
    });
    const provider = { refresh } as unknown as EnrollmentProvider;
    const alerts: ReauthAlertEvent[] = [];
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 55 * MINUTE, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-prep', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-p', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-deferred-retry', readiness: 'ready' });
    expect(alerts).toEqual([]);
  });

  it('should defer a real Claude 5xx token-endpoint response without flipping', async () => {
    // M1 (r2): Claude emits `HTTP <status> <code>` with no parentheses, so
    // the old classifier let a real 503 fall through to reauth_required. An
    // explicit error response proves the grant was not consumed: the next
    // tick retries without an owner alert.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = failWith(
      new Error('Claude enrollment: HTTP 503 oauth_error; reauthenticate'), T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-claude-503', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-c', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-deferred-retry', readiness: 'ready' });
    expect(alerts).toEqual([]);
  });

  it('should flip fail-closed on a Claude timeout that may have rotated the grant', async () => {
    // M1 (r2): `token request timed out` proves no response, not no
    // rotation — the server may have rotated the grant before the abort.
    // Replaying it on the next tick could double-spend the grant family,
    // so the account flips instead of deferring.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = failWith(
      new Error('Claude enrollment: token request timed out; reauthenticate'),
      T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-claude-timeout', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-c', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should flip fail-closed on a raw transport failure with no response', async () => {
    // M1 (r2): Codex and Cloud Code let raw `fetch` errors bubble up. With
    // no response there is no proof the grant survived, so the account
    // flips instead of replaying a possibly consumed grant.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = failWith(
      new TypeError('fetch failed'), T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-codex-fetch', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-x', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should flip fail-closed on a Muse mint failure after token rotation', async () => {
    // M1 (r2): the token endpoint already answered, so the `(503)` inside
    // the mint error must NOT read as a safe retry. The typed
    // post-rotation signal fails closed instead of restoring the fence and
    // replaying the old grant.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = failWith(
      new MusePostRotationError('Muse key mint failed (503): Service Unavailable'),
      T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-muse-mint', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-m', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should defer a Muse token-endpoint 503 before any rotation', async () => {
    // M1 (r2): a 503 from the token endpoint itself is pre-rotation — no
    // new grant was issued — so the explicit response still defers safely.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = failWith(
      new Error('Muse token refresh failed (503): Service Unavailable'),
      T0 + 55 * MINUTE, alerts);
    seed(service, { accountId: 'acct-muse-503', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-m', enrollmentCompletedAt: iso(T0) });
    const report = await service.runCustodianRefreshCycle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(report.accounts[0]).toMatchObject(
      { action: 'refresh-deferred-retry', readiness: 'ready' });
    expect(alerts).toEqual([]);
  });

  it('should run an immediate cycle on loop start and stop cleanly', async () => {
    // M3: readiness is reported at boot, not after one idle interval; stop
    // prevents every later tick.
    vi.useFakeTimers();
    try {
      const { service } = makeService('ok', T0, []);
      seed(service, { accountId: 'acct-loop', ownerScopeRef: 'owner',
        expiresAt: iso(T0 + 600 * MINUTE), refreshToken: 'grant-loop', enrollmentCompletedAt: iso(T0) });
      const reports: CustodianRefreshReport[] = [];
      const stop = service.startCustodianLoop(60_000, (report) => { reports.push(report); });
      await vi.advanceTimersByTimeAsync(0);
      expect(reports).toHaveLength(1);
      expect(reports[0].accounts[0]).toMatchObject({ action: 'skipped-healthy', readiness: 'ready' });
      stop();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reports).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should surface report-listener failures through onError without killing the loop', async () => {
    // M3: a throwing sink or listener must not silence the loop.
    vi.useFakeTimers();
    try {
      const { service } = makeService('ok', T0, []);
      seed(service, { accountId: 'acct-loop', ownerScopeRef: 'owner',
        expiresAt: iso(T0 + 600 * MINUTE), refreshToken: 'grant-loop', enrollmentCompletedAt: iso(T0) });
      let attempts = 0;
      const errors: unknown[] = [];
      service.startCustodianLoop(60_000,
        () => { attempts += 1; throw new Error('listener down'); },
        (error) => { errors.push(error); });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      expect(errors).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100_000);
      expect(attempts).toBe(2);
      expect(errors).toHaveLength(2);
      service.stopCustodianLoop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should surface cycle failures through onError', async () => {
    // M3: a dead keyring ticks visibly instead of looping in silence.
    vi.useFakeTimers();
    try {
      const failingKeyring: KeyringAdapter = {
        getSecret: async (): Promise<string | null> => { throw new Error('keyring down'); },
        setSecret: async (): Promise<void> => {},
        deleteSecret: async (): Promise<void> => {},
      };
      const service = new LocalAccountTransportService(failingKeyring, new Map(),
        { async resolveConfig() { return {}; } }, undefined, { now: () => T0 });
      const errors: unknown[] = [];
      const reports: CustodianRefreshReport[] = [];
      const stop = service.startCustodianLoop(60_000,
        (report) => { reports.push(report); }, (error) => { errors.push(error); });
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toHaveLength(1);
      expect(reports).toEqual([]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should report a refresh already in flight instead of stacking refreshes', async () => {
    // m3: a concurrent cycle must not claim the account is healthy or fire a
    // second refresh while the first one is still running.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    const refresh = vi.fn(async (input: { accountId: string }) => {
      entered = true;
      await gate;
      return { accountId: input.accountId, accessToken: 'fresh-access',
        refreshToken: 'rotated-refresh', expiresAt: iso(T0 + 30 * 24 * 60 * MINUTE),
        authClientConfigVersion: 'v1.0.0' };
    });
    const provider = { refresh } as unknown as EnrollmentProvider;
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 55 * MINUTE, reauthAlert: { notifyReauthRequired: () => {} } });
    seed(service, { accountId: 'acct-flight', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-f', enrollmentCompletedAt: iso(T0) });
    const first = service.runCustodianRefreshCycle();
    await vi.waitFor(() => expect(entered).toBe(true));
    const second = await service.runCustodianRefreshCycle();
    expect(second.accounts[0]).toMatchObject({ action: 'refresh-in-flight', readiness: 'ready' });
    release();
    const settled = await first;
    expect(settled.accounts[0]).toMatchObject({ action: 'refreshed', readiness: 'ready' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('should still alert when persisting the flip fails', async () => {
    // M3: on the acquire path no cycle backstop re-emits, so a keyring
    // outage during the flip persist must not swallow the owner alert.
    const nowRef = { current: T0 };
    const refresh = vi.fn(async (input: { accountId: string }) => ({
      accountId: input.accountId, accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh', expiresAt: iso(nowRef.current + 5 * MINUTE),
      authClientConfigVersion: 'v1.0.0',
    }));
    const provider = { refresh } as unknown as EnrollmentProvider;
    const alerts: ReauthAlertEvent[] = [];
    const keyring = new InMemoryKeyring();
    const service = new LocalAccountTransportService(keyring,
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => nowRef.current, reauthAlert: { notifyReauthRequired: (event) => { alerts.push(event); } } });
    seed(service, { accountId: 'acct-persist', ownerScopeRef: 'owner',
      expiresAt: iso(T0 - MINUTE), refreshToken: 'grant-s', enrollmentCompletedAt: iso(T0) });
    const acquireInput = { accountId: 'acct-persist', ownerScopeRef: 'owner',
      targetProviderId: 'openai' as const, transportProviderId: 'cloud-code' as const };
    // Persist a public record through one successful acquire-time refresh.
    await service.release(await service.acquire(acquireInput));
    expect(alerts).toEqual([]);
    // The credential lapses, the provider reports a definitive revocation,
    // and every later public-record write fails.
    nowRef.current = T0 + 10 * MINUTE;
    refresh.mockImplementation(async () => {
      throw new Error('Codex token refresh failed (400): {"error":"invalid_grant"}');
    });
    // The fence write (first public write of the failing acquire) succeeds
    // so the provider failure is definitive; the flip persist then fails.
    let publicWrites = 0;
    const innerSetSecret = keyring.setSecret.bind(keyring);
    keyring.setSecret = async (key: string, secret: string): Promise<void> => {
      if (key.endsWith(':public') && ++publicWrites > 1) throw new Error('keyring down');
      return innerSetSecret(key, secret);
    };
    await expect(service.acquire(acquireInput)).rejects.toThrow(/reauthentication required/);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should read reauth-required for an expired external seat without flipping it', async () => {
    // The custodian never owns external seats: no flip, no owner alert, but
    // the report must agree with the route directory instead of `ready`.
    const alerts: ReauthAlertEvent[] = [];
    const { service, refresh } = makeService('ok', T0 + 120 * MINUTE, alerts);
    seed(service, { accountId: 'acct-ext-expired', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-ext',
      enrollmentCompletedAt: iso(T0), external: true });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject(
      { action: 'skipped-external', readiness: 'reauth-required' });
    expect(refresh).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('should retry an alert on the next cycle after the sink throws', async () => {
    // A throwing sink clears the epoch entry (including through the
    // same-cycle backstop), so the already-reauth cycle re-emits instead of
    // losing the owner alert silently.
    const alerts: ReauthAlertEvent[] = [];
    let calls = 0;
    const refresh = vi.fn(async () => { throw new Error('provider refresh failed'); });
    const provider = { refresh } as unknown as EnrollmentProvider;
    const service = new LocalAccountTransportService(new InMemoryKeyring(),
      new Map([['cloud-code', provider]]), { async resolveConfig() { return {}; } }, undefined,
      { now: () => T0 + 55 * MINUTE, reauthAlert: { notifyReauthRequired: (event) => {
        calls += 1;
        if (calls <= 2) throw new Error('sink down');
        alerts.push(event);
      } } });
    seed(service, { accountId: 'acct-sink', ownerScopeRef: 'owner',
      expiresAt: iso(T0 + 60 * MINUTE), refreshToken: 'grant-s', enrollmentCompletedAt: iso(T0) });
    const first = await service.runCustodianRefreshCycle();
    expect(first.accounts[0]).toMatchObject(
      { action: 'refresh-failed-reauth', readiness: 'reauth-required' });
    expect(alerts).toEqual([]);
    const second = await service.runCustodianRefreshCycle();
    expect(second.accounts[0]).toMatchObject(
      { action: 'already-reauth', readiness: 'reauth-required' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ reason: 'refresh-failed' });
  });

  it('should clamp an invalid loop interval to the default and floor tiny ones', async () => {
    // NaN, zero and negative intervals cannot schedule ticks; the loop
    // falls back to ~60 s (plus up to 10 % stagger), and sub-second
    // intervals floor to ~1 s. Bounds stay clear of the stagger ceiling so
    // the test never flakes on the jitter.
    vi.useFakeTimers();
    try {
      const { service } = makeService('ok', T0, []);
      seed(service, { accountId: 'acct-loop', ownerScopeRef: 'owner',
        expiresAt: iso(T0 + 600 * MINUTE), refreshToken: 'grant-loop', enrollmentCompletedAt: iso(T0) });
      for (const invalid of [Number.NaN, 0, -5]) {
        const reports: CustodianRefreshReport[] = [];
        const stop = service.startCustodianLoop(invalid, (report) => { reports.push(report); });
        await vi.advanceTimersByTimeAsync(0);
        expect(reports).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(reports).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(reports).toHaveLength(2);
        stop();
      }
      const floored: CustodianRefreshReport[] = [];
      const stopFloor = service.startCustodianLoop(500, (report) => { floored.push(report); });
      await vi.advanceTimersByTimeAsync(0);
      expect(floored).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(floored).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(floored).toHaveLength(2);
      stopFloor();
    } finally {
      vi.useRealTimers();
    }
  });
});
