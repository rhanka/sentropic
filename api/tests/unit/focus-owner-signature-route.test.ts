import { Hono } from 'hono';
import type { FocusLiveSession, OwnerSignatureRequest } from '@sentropic/focus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createApiFocusLiveSessionMock, requireWorkspaceAccessMock, resolveTenantMock } = vi.hoisted(() => ({
  createApiFocusLiveSessionMock: vi.fn(),
  requireWorkspaceAccessMock: vi.fn(),
  resolveTenantMock: vi.fn(),
}));

vi.mock('../../src/services/focus/live-session', () => ({
  createApiFocusLiveSession: createApiFocusLiveSessionMock,
}));

vi.mock('../../src/services/workspace-access', () => ({
  requireWorkspaceAccess: requireWorkspaceAccessMock,
}));

vi.mock('../../src/services/tenancy/resolve-tenant', () => ({
  resolveTenant: resolveTenantMock,
}));

const { focusRouter } = await import('../../src/routes/api/focus');
const { createApiFocusLiveSession } = await import('../../src/services/focus/live-session');

const authenticatedApp = () => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user', {
      userId: 'authenticated-user',
      sessionId: 'authenticated-session',
      role: 'user',
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
    requireWorkspaceAccessMock.mockResolvedValue(undefined);
    resolveTenantMock.mockResolvedValue({ tenantId: 'tenant-from-resolver' });
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

    expect(response.status).toBe(200);
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
      userId: 'authenticated-user',
    });
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
