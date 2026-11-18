import { describe, expect, it, vi } from 'vitest';
import type { EnrollmentProvider } from '../../src/enrollment/contracts.js';
import { MuseCodeEnrollmentProvider } from '../../src/enrollment/muse-code.js';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import { LocalAccountTransportService } from '../../src/service/local-account-transport-service.js';
const OWNER_SCOPE = 'tenant-1:user-1';
const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => payload, text: async () => JSON.stringify(payload),
});
const setupDevice = (tokenPayload: unknown, mintPayload: unknown = { api_key: 'minted-seat-key', user_email: 'seat@example.test' }) => {
  const routes = [
    { match: (u: string) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse({ device_code: 'dev-1', user_code: 'USER-1', verification_uri_complete: 'https://example.test/a', expires_in: 900, interval: 0 }) },
    { match: (u: string) => u.includes('/oidc/device/token/'), respond: () => jsonResponse(tokenPayload) },
    { match: (u: string) => u.includes('/muse-code/key'), respond: () => jsonResponse(mintPayload) },
  ];
  const fetchFn = (async (url: unknown) => {
    const route = routes.find((r) => r.match(String(url)));
    if (!route) throw new Error(`unexpected fetch: ${String(url)}`);
    return route.respond();
  }) as typeof fetch;
  const keyring = new InMemoryKeyring();
  const providers = new Map<string, EnrollmentProvider>([['muse-code', new MuseCodeEnrollmentProvider({ fetchFn })]]);
  const service = new LocalAccountTransportService(keyring, providers, { async resolveConfig() { return {}; } });
  return { keyring, service };
};
describe('Muse device seat lifetime (service)', () => {
  it('keeps an unknown-expiry seat ready past the OAuth hour', async () => {
    const { service } = setupDevice({ access_token: 'dca-1', expires_in: 3600 });
    const session = await service.enroll('muse-code', { configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: OWNER_SCOPE });
    const completion = await service.completeMuseDeviceImport(session.enrollmentId, OWNER_SCOPE, 5);
    const acquisition = await service.acquire({ targetProviderId: 'muse', transportProviderId: 'muse', ownerScopeRef: OWNER_SCOPE, now: Date.now() + 2 * 3600 * 1000 });
    expect(acquisition.material.accountId).toBe(completion.accountId);
    expect(acquisition.material.accessToken).toBe('minted-seat-key');
    const eligible = await service.createRouteDirectory({} as never).listEligible({ principalRef: 'owner', ownerScopeRef: OWNER_SCOPE });
    expect(eligible.find((e) => e.accountRef === completion.accountId)?.readiness).toBe('ready');
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts.find((a) => a.transportProviderId === 'muse')).toMatchObject({ action: 'skipped-no-expiry', readiness: 'ready' });
  });
  it('never persists the device grant outside the sealed envelope', async () => {
    const { keyring, service } = setupDevice({ access_token: 'dca-secret-1', expires_in: 3600 });
    const session = await service.enroll('muse-code', { configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: OWNER_SCOPE });
    const completion = await service.completeMuseDeviceImport(session.enrollmentId, OWNER_SCOPE, 5);
    const prefix = `sentropic-llm-mesh:${completion.accountId}`;
    expect(await keyring.getSecret(`${prefix}:public`)).not.toContain('dca-secret-1');
    expect(await keyring.getSecret(`${prefix}:envelope`)).toContain('dca-secret-1');
    expect(JSON.stringify(await service.runCustodianRefreshCycle())).not.toContain('dca-secret-1');
  });
  it('re-mints when the minted key carries an expiry', async () => {
    let mintCount = 0;
    const routes = [
      { match: (u: string) => u.includes('/oidc/device/authorization/'), respond: () => jsonResponse({ device_code: 'dev-1', user_code: 'USER-1', verification_uri_complete: 'https://example.test/a', expires_in: 900, interval: 0 }) },
      { match: (u: string) => u.includes('/oidc/device/token/'), respond: () => jsonResponse({ access_token: 'dca-1', expires_in: 3600 }) },
      { match: (u: string) => u.includes('/muse-code/key'), respond: () => { mintCount += 1; return mintCount === 1 ? jsonResponse({ api_key: 'minted-seat-key', user_email: 'seat@example.test', expires_in: 60 }) : jsonResponse({ api_key: 'minted-seat-key-2', user_email: 'seat@example.test' }); } },
    ];
    const fetchFn = (async (url: unknown) => {
      const route = routes.find((r) => r.match(String(url)));
      if (!route) throw new Error(`unexpected fetch: ${String(url)}`);
      return route.respond();
    }) as typeof fetch;
    const keyring = new InMemoryKeyring();
    const service = new LocalAccountTransportService(keyring, new Map<string, EnrollmentProvider>([['muse-code', new MuseCodeEnrollmentProvider({ fetchFn })]]), { async resolveConfig() { return {}; } });
    const session = await service.enroll('muse-code', { configRef: 'default', mode: 'cli', redirectUri: 'http://127.0.0.1', ownerScope: OWNER_SCOPE });
    const completion = await service.completeMuseDeviceImport(session.enrollmentId, OWNER_SCOPE, 5);
    const acquisition = await service.acquire({ targetProviderId: 'muse', transportProviderId: 'muse', ownerScopeRef: OWNER_SCOPE, now: Date.now() + 2 * 3600 * 1000 });
    expect(acquisition.material.accessToken).toBe('minted-seat-key-2');
    expect(completion.accountId).toBe(acquisition.material.accountId);
    expect(mintCount).toBe(2);
  });
  it('marks a grant-less device seat reauth-required', async () => {
    const museCodeRefresh = vi.fn(async () => { throw Object.assign(new Error('Muse device grant missing'), { status: 401, code: 'AUTHENTICATION_FAILED' }); });
    const service = new LocalAccountTransportService(new InMemoryKeyring(), new Map<string, EnrollmentProvider>([['muse-code', { refresh: museCodeRefresh } as unknown as EnrollmentProvider]]), { async resolveConfig() { return {}; } });
    service.registerAccount({ accountId: 'acct_muse_device', ownerScopeRef: OWNER_SCOPE, accountLabel: 'Muse device', targetProviderId: 'muse', transportProviderId: 'muse', accessToken: 'old-key', expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'active', metadata: { billing_type: 'seat', auth_type: 'device-flow' } });
    const report = await service.runCustodianRefreshCycle();
    expect(report.accounts[0]).toMatchObject({ readiness: 'reauth-required' });
    expect(museCodeRefresh).not.toHaveBeenCalled();
  });
});
