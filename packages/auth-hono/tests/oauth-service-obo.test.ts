import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import type { AuthHonoServiceTenantPort } from '../src/index.js';
import { createOauthPorts, createOauthRouterForTest, createServiceClient } from './__fixtures__/oauth-fixtures.js';

// ARCH-11 G1c — S2S on-behalf-of (OBO) tenant mint (spec §2.2), at the auth-hono WIRING level.
// The host `serviceTenant` port owns the policy (mode-gating lives in the api adapter); these tests
// prove the token handler consults it, emits `tid`, and rejects `invalid_target` fail-closed — and
// that its ABSENCE is byte-identical to the pre-G1c stateless service token (no tid, no rejection).

const CLIENT_ID = 'service-rp';
const CLIENT_SECRET = 'service-secret';

const serviceClient = createServiceClient({ clientId: CLIENT_ID, tenantId: 'org-a' });

const clientCredentialsRequest = (
  router: ReturnType<typeof createOauthRouterForTest>['router'],
  extra: Record<string, string> = {}
) =>
  router.request('/oauth/token', {
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'service:ping', ...extra }).toString(),
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

describe('OAuth S2S OBO mint (ARCH-11 G1c)', () => {
  it('no serviceTenant port → NO tid, no rejection (byte-identical to pre-G1c)', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [serviceClient] });
    const { router } = createOauthRouterForTest({ ports });

    const response = await clientCredentialsRequest(router, { tenant: 'org-a' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(decodeJwt(body.access_token)).not.toHaveProperty('tid');
  });

  it('serviceTenant returns { tid: null } (shadow) → NO tid', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [serviceClient] });
    ports.serviceTenant = { resolveOboTenant: async () => ({ tid: null }) };
    const { router } = createOauthRouterForTest({ ports });

    const response = await clientCredentialsRequest(router, { tenant: 'org-a' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(decodeJwt(body.access_token)).not.toHaveProperty('tid');
  });

  it('serviceTenant returns { tid } (strict) → tid emitted, and the requested tenant is forwarded', async () => {
    let seenRequested: string | null | undefined;
    const port: AuthHonoServiceTenantPort = {
      resolveOboTenant: async ({ clientId, fixedTenantId, requestedTenant }) => {
        seenRequested = requestedTenant;
        expect(clientId).toBe(CLIENT_ID);
        expect(fixedTenantId).toBe('org-a');
        return { tid: requestedTenant ?? fixedTenantId ?? 'org-a' };
      },
    };
    const { ports } = await createOauthPorts({ serviceClients: [serviceClient] });
    ports.serviceTenant = port;
    const { router } = createOauthRouterForTest({ ports });

    const response = await clientCredentialsRequest(router, { tenant: 'org-b' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(decodeJwt(body.access_token)).toMatchObject({ tid: 'org-b', client_id: CLIENT_ID });
    expect(seenRequested).toBe('org-b');
  });

  it('an omitted tenant param forwards requestedTenant=null (single-org binds fixed)', async () => {
    let seenRequested: string | null | undefined = 'unset';
    const { ports } = await createOauthPorts({ serviceClients: [serviceClient] });
    ports.serviceTenant = {
      resolveOboTenant: async ({ fixedTenantId, requestedTenant }) => {
        seenRequested = requestedTenant;
        return { tid: fixedTenantId };
      },
    };
    const { router } = createOauthRouterForTest({ ports });

    const response = await clientCredentialsRequest(router); // no `tenant` param
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(decodeJwt(body.access_token)).toMatchObject({ tid: 'org-a' });
    expect(seenRequested).toBeNull();
  });

  it('serviceTenant returns { error } (strict fail-closed) → 400 invalid_target', async () => {
    const { ports } = await createOauthPorts({ serviceClients: [serviceClient] });
    ports.serviceTenant = {
      resolveOboTenant: async () => ({ error: 'invalid_target', description: 'not authorized' }),
    };
    const { router } = createOauthRouterForTest({ ports });

    const response = await clientCredentialsRequest(router, { tenant: 'org-x' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_target');
  });
});
