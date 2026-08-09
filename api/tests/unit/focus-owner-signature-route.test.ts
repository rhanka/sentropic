import { Hono } from 'hono';
import type { FocusLiveSession, OwnerSignatureRequest } from '@sentropic/focus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createApiFocusLiveSessionMock, isTenantAdminMock, requireWorkspaceAccessMock, resolveTenantMock } = vi.hoisted(() => ({
  createApiFocusLiveSessionMock: vi.fn(),
  isTenantAdminMock: vi.fn(),
  requireWorkspaceAccessMock: vi.fn(),
  resolveTenantMock: vi.fn(),
}));

vi.mock('../../src/services/focus/live-session', () => ({
  createApiFocusLiveSession: createApiFocusLiveSessionMock,
}));

vi.mock('../../src/services/workspace-access', () => ({
  requireWorkspaceAccess: requireWorkspaceAccessMock,
}));

vi.mock('../../src/services/auth/tenant-membership', () => ({
  isTenantAdmin: isTenantAdminMock,
}));

vi.mock('../../src/services/tenancy/resolve-tenant', () => ({
  resolveTenant: resolveTenantMock,
}));

const HTTP_RELAYER = Object.freeze({
  transport: 'http' as const,
  relayerId: 'sentropic-api',
  canonicalIdentity: Object.freeze({
    issuer: 'sentropic-api',
    subject: 'focus-owner-signature-route',
  }),
});

const { focusRouter } = await import('../../src/routes/api/focus');
const { trackDecisionValidator } = await import('../../src/services/focus/decision-validator');
const { createApiFocusLiveSession } = await import('../../src/services/focus/live-session');

const authenticatedApp = (role = 'user') => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'authenticated-user',
      sessionId: 'authenticated-session',
      authenticatedAt: '2026-08-08T12:00:00.000Z',
      role,
      workspaceId: 'workspace-from-auth-context',
    });
    await next();
  });
  app.route('/focus', focusRouter);
  return app;
};

describe('Focus owner-signature route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(trackDecisionValidator, 'validate').mockResolvedValue({ authorized: true });
    isTenantAdminMock.mockResolvedValue(true);
    requireWorkspaceAccessMock.mockResolvedValue(undefined);
    resolveTenantMock.mockResolvedValue({ tenantId: 'tenant-from-resolver' });
  });

  it('should return not-done before creating a Focus session when decision validation denies', async () => {
    vi.spyOn(trackDecisionValidator, 'validate').mockResolvedValue({
      authorized: false,
      reason: 'track-store-unavailable',
    });

    const response = await authenticatedApp().request('http://localhost/focus/owner-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision_id: 'decision-42',
        idempotency_key: 'request-retry-42',
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'not-done',
      reason: 'track-store-unavailable',
    });
    expect(createApiFocusLiveSessionMock).not.toHaveBeenCalled();
  });

  it('should submit a session-derived owner signature through the durable Focus composition', async () => {
    let capturedRequest: OwnerSignatureRequest | undefined;
    let capturedDependencies: Parameters<typeof createApiFocusLiveSession>[0] | undefined;

    createApiFocusLiveSessionMock.mockImplementation((dependencies: Parameters<typeof createApiFocusLiveSession>[0]) => {
      capturedDependencies = dependencies;
      return {
        sign: async (request: OwnerSignatureRequest) => {
          capturedRequest = request;
          return {
            status: 'signed' as const,
            duplicate: false,
            persisted: {
              contractVersion: 'track-owner-signature/1.0.0' as const,
              target: request.target,
              attestation: {
                attester: {
                  principalId: 'authenticated-user',
                  canonicalIdentity: {
                    issuer: 'sentropic-api-session',
                    subject: 'authenticated-user',
                  },
                  authenticatedAt: '2026-08-08T12:00:00.000Z',
                },
              },
              relayer: {
                transport: 'http' as const,
                relayerId: 'sentropic-api',
                canonicalIdentity: {
                  issuer: 'sentropic-api',
                  subject: 'focus-owner-signature-route',
                },
              },
              idempotencyKey: request.idempotencyKey,
              recordId: 'durable-record-id',
            },
          };
        },
      } as FocusLiveSession;
    });

    const response = await authenticatedApp().request('http://localhost/focus/owner-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision_id: 'decision-42',
        idempotency_key: 'request-retry-42',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'signed', duplicate: false });
    expect(createApiFocusLiveSessionMock).toHaveBeenCalledOnce();
    expect(capturedRequest).toEqual({
      target: { workspace: 'workspace-from-auth-context', decisionId: 'decision-42' },
      authentication: { kind: 'own-principal', proof: { sessionId: 'authenticated-session' } },
      idempotencyKey: 'request-retry-42',
    });
    expect(capturedDependencies).toBeDefined();
    if (!capturedDependencies || !capturedRequest) throw new Error('Focus composition was not captured');

    const owner = await capturedDependencies.ownPrincipal.authenticate(capturedRequest);
    expect(owner).toMatchObject({
      principalId: 'authenticated-user',
      canonicalIdentity: { issuer: 'sentropic-api-session', subject: 'authenticated-user' },
    });
    expect(await capturedDependencies.relayerProvenance.getRelayerProvenance()).toEqual({
      transport: 'http',
      relayerId: 'sentropic-api',
      canonicalIdentity: { issuer: 'sentropic-api', subject: 'focus-owner-signature-route' },
    });
    expect(await capturedDependencies.authorizer.authorize({ owner: owner!, target: capturedRequest.target })).toBe(true);
    expect(requireWorkspaceAccessMock).toHaveBeenCalledWith('authenticated-user', 'workspace-from-auth-context');
    expect(resolveTenantMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-from-auth-context',
    });
    expect(isTenantAdminMock).toHaveBeenCalledWith('authenticated-user', 'tenant-from-resolver', 'user');
  });

  it('should admit an admin_app caller when decision validation is authorized', async () => {
    createApiFocusLiveSessionMock.mockImplementation((dependencies: Parameters<typeof createApiFocusLiveSession>[0]) => ({
      sign: async (request: OwnerSignatureRequest) => {
        const owner = await dependencies.ownPrincipal.authenticate(request);
        if (!owner) return { status: 'not-done' as const, reason: 'owner-authentication-required' as const };

        const authorized = await dependencies.authorizer.authorize({ owner, target: request.target });
        if (!authorized) return { status: 'not-done' as const, reason: 'authorization-denied' as const };

        return {
          status: 'signed' as const,
          duplicate: false,
          persisted: {
            contractVersion: 'track-owner-signature/1.0.0' as const,
            target: request.target,
            attestation: { attester: owner },
            relayer: HTTP_RELAYER,
            idempotencyKey: request.idempotencyKey,
            recordId: 'durable-record-id',
          },
        };
      },
    } as FocusLiveSession));

    const response = await authenticatedApp('admin_app').request('http://localhost/focus/owner-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision_id: 'decision-42', idempotency_key: 'request-retry-42' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: 'signed', duplicate: false });
    expect(failClosedDecisionValidator.validate).toHaveBeenCalledWith({
      workspace: 'workspace-from-auth-context',
      decisionId: 'decision-42',
      userId: 'authenticated-user',
    });
    expect(isTenantAdminMock).toHaveBeenCalledWith('authenticated-user', 'tenant-from-resolver', 'admin_app');
  });

  it('should keep an authenticated session attestation stable for a delayed retry', async () => {
    let persistedOwner: Awaited<ReturnType<Parameters<typeof createApiFocusLiveSession>[0]['ownPrincipal']['authenticate']>>;

    createApiFocusLiveSessionMock.mockImplementation((dependencies: Parameters<typeof createApiFocusLiveSession>[0]) => ({
      sign: async (request: OwnerSignatureRequest) => {
        const owner = await dependencies.ownPrincipal.authenticate(request);
        if (!owner) return { status: 'not-done' as const, reason: 'owner-authentication-required' as const };

        if (!persistedOwner) {
          persistedOwner = owner;
          return {
            status: 'signed' as const,
            duplicate: false,
            persisted: {
              contractVersion: 'track-owner-signature/1.0.0' as const,
              target: request.target,
              attestation: { attester: owner },
              relayer: HTTP_RELAYER,
              idempotencyKey: request.idempotencyKey,
              recordId: 'durable-record-id',
            },
          };
        }

        if (owner.authenticatedAt !== persistedOwner.authenticatedAt) {
          return { status: 'not-done' as const, reason: 'persisted-attestation-not-confirmed' as const };
        }

        return {
          status: 'signed' as const,
          duplicate: true,
          persisted: {
            contractVersion: 'track-owner-signature/1.0.0' as const,
            target: request.target,
            attestation: { attester: persistedOwner },
            relayer: HTTP_RELAYER,
            idempotencyKey: request.idempotencyKey,
            recordId: 'durable-record-id',
          },
        };
      },
    } as FocusLiveSession));

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
      const app = authenticatedApp();
      const request = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: 'decision-42', idempotency_key: 'request-retry-42' }),
      };

      const first = await app.request('http://localhost/focus/owner-signatures', request);
      vi.setSystemTime(new Date('2026-08-08T12:01:00.000Z'));
      const retry = await app.request('http://localhost/focus/owner-signatures', request);

      expect(await first.json()).toMatchObject({ status: 'signed', duplicate: false });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: 'signed', duplicate: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return a non-2xx result when owner authorization is denied', async () => {
    createApiFocusLiveSessionMock.mockReturnValue({
      sign: async () => ({ status: 'not-done' as const, reason: 'authorization-denied' as const }),
    } as FocusLiveSession);

    const response = await authenticatedApp().request('http://localhost/focus/owner-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision_id: 'decision-42', idempotency_key: 'request-retry-42' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: 'not-done', reason: 'authorization-denied' });
  });

  it('should reject a suspended tenant member after a cached tenant resolution', async () => {
    let persistedSignatures = 0;
    isTenantAdminMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    createApiFocusLiveSessionMock.mockImplementation((dependencies: Parameters<typeof createApiFocusLiveSession>[0]) => ({
      sign: async (request: OwnerSignatureRequest) => {
        const owner = await dependencies.ownPrincipal.authenticate(request);
        if (!owner) return { status: 'not-done' as const, reason: 'owner-authentication-required' as const };

        const authorized = await dependencies.authorizer.authorize({ owner, target: request.target });
        if (!authorized) return { status: 'not-done' as const, reason: 'authorization-denied' as const };

        persistedSignatures += 1;
        return {
          status: 'signed' as const,
          duplicate: false,
          persisted: {
            contractVersion: 'track-owner-signature/1.0.0' as const,
            target: request.target,
            attestation: { attester: owner },
            relayer: HTTP_RELAYER,
            idempotencyKey: request.idempotencyKey,
            recordId: `durable-record-${persistedSignatures}`,
          },
        };
      },
    } as FocusLiveSession));

    const app = authenticatedApp();
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision_id: 'decision-42', idempotency_key: 'request-retry-42' }),
    };

    const approved = await app.request('http://localhost/focus/owner-signatures', request);
    const suspended = await app.request('http://localhost/focus/owner-signatures', request);

    expect(approved.status).toBe(201);
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toEqual({ status: 'not-done', reason: 'authorization-denied' });
    expect(persistedSignatures).toBe(1);
    expect(resolveTenantMock).toHaveBeenNthCalledWith(1, { workspaceId: 'workspace-from-auth-context' });
    expect(resolveTenantMock).toHaveBeenNthCalledWith(2, { workspaceId: 'workspace-from-auth-context' });
    expect(isTenantAdminMock).toHaveBeenCalledTimes(2);
  });

  it('should reject direct access without an authenticated context', async () => {
    const app = new Hono();
    app.route('/focus', focusRouter);

    const response = await app.request('http://localhost/focus/owner-signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision_id: 'decision-42', idempotency_key: 'request-retry-42' }),
    });

    expect(response.status).toBe(401);
    expect(createApiFocusLiveSessionMock).not.toHaveBeenCalled();
  });
});
