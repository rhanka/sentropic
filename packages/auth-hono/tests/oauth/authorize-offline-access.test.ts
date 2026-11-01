import { describe, expect, it } from 'vitest';
import { authorizePath, createOauthClient, createOauthPorts, createOauthRouterForTest } from '../__fixtures__/oauth-fixtures.js';
import { refreshFixture } from './refresh-fixtures.js';
import { createWellKnownRouter, hasOfflineCoverage, isRefreshEligibleClient } from '../../src/index.js';

describe('offline authorization consent', () => {
  it('should require both grants even when a registration bypasses the registration script', () => {
    const client = createOauthClient({ allowedScopes: ['offline_access'], grantTypes: ['refresh_token'] });
    expect(isRefreshEligibleClient(client)).toBe(false);
    client.grantTypes.push('authorization_code');
    expect(isRefreshEligibleClient(client)).toBe(true);
  });

  it('should require exact issuer, epoch, scope set and resource or explicit default approval', () => {
    const grant = { scopes: ['read', 'offline_access'], offlineScopes: ['read', 'offline_access'],
      offlineGrantId: 'epoch', offlineIssuer: 'https://idp.test', offlineConsentedAt: new Date(),
      approvedResources: ['https://a.test'], defaultAudienceApproved: false };
    const request = { issuer: 'https://idp.test', offlineGrantId: 'epoch', scope: 'read offline_access', resource: 'https://a.test' };
    expect(hasOfflineCoverage(grant, request)).toBe(true);
    expect(hasOfflineCoverage({ scopes: grant.scopes }, request)).toBe(false);
    for (const patch of [{ issuer: 'https://other.test' }, { offlineGrantId: 'old' },
      { scope: 'write offline_access' }, { resource: 'https://b.test' }, { resource: null }]) {
      expect(hasOfflineCoverage(grant, { ...request, ...patch })).toBe(false);
    }
    expect(hasOfflineCoverage({ ...grant, defaultAudienceApproved: true }, { ...request, resource: null })).toBe(true);
  });
  it('should advertise refresh only for a live opted-in client on both discovery endpoints', async () => {
    const f = await refreshFixture();
    const discovery = createWellKnownRouter({ issuer: 'http://localhost:9197', ports: f.ports });
    for (const endpoint of ['/openid-configuration', '/oauth-authorization-server']) {
      expect((await (await discovery.request(endpoint)).json()).grant_types_supported).not.toContain('refresh_token');
      const enabled = await (await discovery.request(`${endpoint}?client_id=example-rp`)).json();
      expect(enabled.grant_types_supported).toContain('refresh_token');
      expect(enabled.scopes_supported).toContain('offline_access');
      f.client.requiredAcr = 'urn:sentropic:loa:bearer';
      expect((await (await discovery.request(`${endpoint}?client_id=example-rp`)).json()).grant_types_supported)
        .not.toContain('refresh_token');
      f.client.requiredAcr = null;
    }
  });
  it('should accept only opted-in clients and require current resource-specific consent', async () => {
    const f = await refreshFixture();
    const response = await f.router.request(authorizePath({ scope: 'profile offline_access', resource: 'https://resource.test/mcp' }));
    expect(new URL(response.headers.get('location')!).searchParams.has('code')).toBe(true);
    const other = await f.router.request(authorizePath({ scope: 'profile offline_access' }));
    expect(new URL(other.headers.get('location')!).searchParams.has('code')).toBe(true);
    f.withdraw();
    const legacy = await f.router.request(authorizePath({ scope: 'profile offline_access' }));
    expect(legacy.headers.get('location')).toContain('/auth/oauth/consent');
    f.client.grantTypes = ['authorization_code'];
    const disabled = await f.router.request(authorizePath({ scope: 'profile offline_access' }));
    expect(new URL(disabled.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope');
  });

  it.each([null, 'urn:sentropic:loa:bearer', 'unknown'])('should default deny unless opt-in and null ACR (%s)', async (acr) => {
    const client = createOauthClient({ allowedScopes: ['offline_access'], requiredAcr: acr });
    const { ports } = await createOauthPorts({ clients: [client], authenticated: true });
    const { router } = createOauthRouterForTest({ ports });
    const response = await router.request(authorizePath({ scope: 'offline_access' }));
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope');
  });
});
