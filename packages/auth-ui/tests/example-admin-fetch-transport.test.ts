/**
 * Consumer integration proof for `spa-transpose-cv`-style hosts.
 *
 * `spa-transpose-cv` mounts the same Hono auth handlers under `/admin/auth/*`
 * (so its admin panel can do passkey login without colliding with the
 * public surface). It also supplies custom French labels for an
 * admin-flavoured copy ("Connexion admin", etc.) and does not need workspace
 * scoping.
 *
 * This test demonstrates that the package transport can be configured by
 * pure constructor injection — no source change in the package, no host
 * coupling — and is end-to-end exercised through a fake `fetch`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  assertAuthUiTransport,
  createDefaultFetchTransport,
  createFrenchAuthUiLabels,
  type AuthUiLabels,
  type AuthUiTransport,
} from '../src/index.js';

const adminLabels: Partial<AuthUiLabels> = {
  loginTitle: 'Connexion admin',
  loginButton: 'Se connecter (admin)',
  registerTitle: 'Inviter un administrateur',
  registerSubtitle: 'Réservé aux super-admins.',
};

interface AdminFetchOptions {
  fetchMock: ReturnType<typeof vi.fn>;
  tenant: string;
  bearer: string;
}

const createAdminTransport = ({ fetchMock, tenant, bearer }: AdminFetchOptions): AuthUiTransport =>
  createDefaultFetchTransport({
    baseUrl: '/admin/auth',
    fetch: fetchMock,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'x-admin-tenant': tenant,
    },
    withCredentials: false,
    onUnauthorized: () => {},
  });

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('example admin host transport', () => {
  it('proves the package contract is shape-compatible with a non-Sentropic mount', () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    const transport = createAdminTransport({ fetchMock, tenant: 'acme', bearer: 'token-abc' });
    expect(assertAuthUiTransport(transport)).toBe(transport);
  });

  it('routes the email-code request to /admin/auth/email/verify-request with admin headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ delivery: 'email' }));
    const transport = createAdminTransport({ fetchMock, tenant: 'acme', bearer: 'token-abc' });

    const result = await transport.requestEmailCode({ email: 'admin@acme.example' });
    expect(result.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/admin/auth/email/verify-request');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    expect(headers['x-admin-tenant']).toBe('acme');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'admin@acme.example' });
  });

  it('walks the full email-OTP + passkey registration through the admin mount', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ delivery: 'email' }))
      .mockResolvedValueOnce(okResponse({ verificationToken: 'verify-token-1' }))
      .mockResolvedValueOnce(okResponse({
        userId: 'user-1',
        options: { challenge: 'abc', rp: { name: 'Admin Console' }, user: { id: 'user-1', name: 'admin@acme.example', displayName: 'Admin' }, pubKeyCredParams: [] },
      }))
      .mockResolvedValueOnce(okResponse({ user: { id: 'user-1', email: 'admin@acme.example', role: 'admin_app' }, sessionToken: 'session-abc' }));

    const transport = createAdminTransport({ fetchMock, tenant: 'acme', bearer: 'token-abc' });

    expect((await transport.requestEmailCode({ email: 'admin@acme.example' })).ok).toBe(true);
    const verifyResult = await transport.verifyEmailCode({ email: 'admin@acme.example', code: '123456' });
    expect(verifyResult.ok).toBe(true);
    if (!verifyResult.ok) return;
    expect(verifyResult.value.verificationToken).toBe('verify-token-1');

    const optionsResult = await transport.createPasskeyRegistrationOptions({
      email: 'admin@acme.example',
      verificationToken: verifyResult.value.verificationToken,
      deviceName: 'Admin laptop',
    });
    expect(optionsResult.ok).toBe(true);
    if (!optionsResult.ok) return;

    const verifyRegistration = await transport.verifyPasskeyRegistration({
      email: 'admin@acme.example',
      verificationToken: verifyResult.value.verificationToken,
      userId: optionsResult.value.userId,
      credential: { id: 'cred-1', rawId: 'cred-1', response: { clientDataJSON: 'a', attestationObject: 'b' }, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform' },
      deviceName: 'Admin laptop',
    });
    expect(verifyRegistration.ok).toBe(true);
    if (!verifyRegistration.ok) return;
    expect(verifyRegistration.value.sessionToken).toBe('session-abc');
    expect(verifyRegistration.value.user.role).toBe('admin_app');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/admin/auth/email/verify-request',
      '/admin/auth/email/verify-code',
      '/admin/auth/register/options',
      '/admin/auth/register/verify',
    ]);
  });

  it('lets the admin host override copy via Partial<AuthUiLabels>', () => {
    const labels: AuthUiLabels = createFrenchAuthUiLabels(adminLabels);
    expect(labels.loginTitle).toBe('Connexion admin');
    expect(labels.loginButton).toBe('Se connecter (admin)');
    expect(labels.registerTitle).toBe('Inviter un administrateur');
    // unaltered keys keep the FR baseline
    expect(labels.devicesTitle).toBe('Mes appareils');
  });

  it('approves a device pairing through the admin mount with snake_case body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ deviceName: 'Admin laptop' }));
    const transport = createAdminTransport({ fetchMock, tenant: 'acme', bearer: 'token-abc' });

    const result = await transport.approveDevicePairing({ userCode: 'PAIR-9999', deviceName: 'Admin laptop' });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/admin/auth/device/approve');
    expect(JSON.parse(init.body as string)).toEqual({ user_code: 'PAIR-9999', device_name: 'Admin laptop' });
  });
});
