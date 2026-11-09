import { describe, expect, it, vi } from 'vitest';
import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import type { ReauthAlertEvent } from '../../src/service/reauth-alert.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
import { markExternalSeatAuthority } from '../../src/service/external-seat-authority.js';

const MINUTE = 60_000;
// Anchored on the real clock: provider refresh validation uses Date.now(), so
// stubbed expiries must lie in the real future while the custodian clock stays set per test.
const T0 = Date.now();
const iso = (ms: number): string => new Date(ms).toISOString();

const stubProvider = (behavior: 'ok' | 'fail') => {
  const refresh = vi.fn(async (input: { accountId: string }) => {
    if (behavior === 'fail') throw new Error('provider refresh failed');
    return { accountId: input.accountId, accessToken: 'fresh-access',
      refreshToken: 'rotated-refresh', expiresAt: iso(Date.now() + 24 * 60 * MINUTE),
      authClientConfigVersion: 'v1.0.0' };
  });
  return { provider: { refresh } as unknown as EnrollmentProvider, refresh };
};

const seed = (service: LocalAccountTransportService, input: { accountId: string;
  ownerScopeRef: string; refreshToken?: string | null; expiresAt?: string | null;
  enrollmentCompletedAt?: string; external?: boolean }): void => {
  service.registerAccount({ accountId: input.accountId, ownerScopeRef: input.ownerScopeRef,
    accountLabel: `${input.ownerScopeRef} label`, targetProviderId: 'openai' as const,
    transportProviderId: 'cloud-code' as const, accessToken: 'old-access',
    ...(input.refreshToken === undefined ? {} : { refreshToken: input.refreshToken }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }), status: 'active',
    ...(input.enrollmentCompletedAt ? { enrollmentCompletedAt: input.enrollmentCompletedAt } : {}),
    ...(input.external ? { metadata: markExternalSeatAuthority(undefined, { seatRef: 'seat-1',
      ownerScope: input.ownerScopeRef, epoch: 1, generation: 1, operationId: 'op-test-1' }) } : {}),
  });
};

const makeService = (behavior: 'ok' | 'fail', now: number, alerts: ReauthAlertEvent[]) => {
  const { provider, refresh } = stubProvider(behavior);
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
});
