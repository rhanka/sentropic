import { describe, expect, it } from 'vitest';

import {
  createAuthCredentialRouteHandlers,
  type AuthHonoCredentialSessionResolver,
  createAuthRouter,
  type AuthHonoCredentialPort,
  type AuthHonoCredentialRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');

const credential = (input: Partial<AuthHonoCredentialRecord> = {}): AuthHonoCredentialRecord => ({
  backedUp: false,
  counter: 1,
  createdAt: now,
  credentialId: 'credential-id-1',
  deviceType: 'single_device',
  id: 'cred-1',
  lastUsedAt: now,
  name: 'Laptop',
  publicKey: 'public-key',
  revokedAt: null,
  transports: ['internal'],
  userId: 'user-1',
  ...input,
});

const credentialPort = (overrides: Partial<AuthHonoCredentialPort> = {}): AuthHonoCredentialPort => ({
  create: async () => credential(),
  findByCredentialId: async () => null,
  findById: async () => credential(),
  listForUser: async () => [credential()],
  rename: async () => credential({ name: 'Renamed Device' }),
  revoke: async () => true,
  updateCounter: async () => undefined,
  ...overrides,
});

const session = (
  resolver: AuthHonoCredentialSessionResolver = async () => ({ userId: 'user-1' })
): AuthHonoCredentialSessionResolver => resolver;

const router = (
  credentials: AuthHonoCredentialPort,
  resolveSession: AuthHonoCredentialSessionResolver = session()
) =>
  createAuthRouter({
    handlers: createAuthCredentialRouteHandlers({ credentials, resolveSession }),
    routePrefix: '/api/v1/auth',
  });

describe('createAuthCredentialRouteHandlers', () => {
  it('returns authentication_required when session is missing', async () => {
    const response = await router(credentialPort(), session(async () => null)).request(
      '/api/v1/auth/credentials'
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'authentication_required',
        message: 'Authentication is required to access credentials.',
      },
    });
  });

  it('lists credentials for the authenticated user', async () => {
    const response = await router(credentialPort()).request('/api/v1/auth/credentials');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      credentials: [
        {
          backedUp: false,
          counter: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          credentialId: 'credential-id-1',
          deviceName: 'Laptop',
          deviceType: 'single_device',
          id: 'cred-1',
          lastUsedAt: '2026-01-01T00:00:00.000Z',
          transports: ['internal'],
        },
      ],
    });
  });

  it('renames and revokes owned credentials', async () => {
    const app = router(credentialPort());
    const renameResponse = await app.request('/api/v1/auth/credentials/cred-1', {
      body: JSON.stringify({ deviceName: 'Renamed Device' }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    const revokeResponse = await app.request('/api/v1/auth/credentials/cred-1', { method: 'DELETE' });

    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toMatchObject({
      credential: { deviceName: 'Renamed Device', id: 'cred-1' },
      success: true,
    });
    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toEqual({ success: true });
  });

  it('maps invalid, missing, and foreign credential errors', async () => {
    const app = router(credentialPort({ findById: async () => null }));
    const invalidResponse = await app.request('/api/v1/auth/credentials/cred-1', {
      body: JSON.stringify({ deviceName: '' }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    const missingResponse = await app.request('/api/v1/auth/credentials/missing', { method: 'DELETE' });
    const foreignResponse = await router(
      credentialPort({ findById: async () => credential({ userId: 'user-2' }) })
    ).request('/api/v1/auth/credentials/cred-1', { method: 'DELETE' });

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: { code: 'invalid_input' },
    });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      error: { code: 'credential_not_found', message: 'Credential not found.' },
    });
    expect(foreignResponse.status).toBe(403);
    await expect(foreignResponse.json()).resolves.toEqual({
      error: {
        code: 'forbidden',
        message: 'Credential does not belong to the authenticated user.',
      },
    });
  });
});
