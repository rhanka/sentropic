import { describe, expect, it } from 'vitest';
import { authorizePath, createOauthClient, createOauthPorts, createOauthRouterForTest } from '../__fixtures__/oauth-fixtures.js';
import { refreshFixture } from './refresh-fixtures.js';

describe('offline authorization consent', () => {
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
