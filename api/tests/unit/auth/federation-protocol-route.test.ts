import { describe, expect, it, vi } from 'vitest';
import { createFederationRouter } from '../../../src/routes/namespaces/auth/federation';

const harness = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), rootAudit: vi.fn(() => {
  throw new Error('Root identity audit is unavailable');
}) }));
vi.mock('../../../src/logger', () => ({ logger: harness }));
vi.mock('../../../src/services/auth/federation/registry', () => ({
  isFederationProviderSupported: () => true,
  resolveFederationProvider: () => ({ id: 'google',
    createAuthorizationUrl: () => 'https://provider.test/authorize', verifyCallback: vi.fn() }),
}));
vi.mock('../../../src/services/session-manager', () => ({ validateSession: vi.fn() }));
vi.mock('../../../src/services/identity/cm-federation-completion', () => ({
  createCmFederationCompletion: () => () => { throw new Error('Identity completion must not run'); },
}));
vi.mock('../../../src/routes/auth/oauth', () => ({
  resolveOAuthIssuer: () => 'https://issuer.test', resolveOAuthUiBaseUrl: () => 'https://app.test',
  getSentropicOAuthPorts: () => ({
    auditLog: { record: harness.rootAudit },
    clock: { now: () => new Date(), addSeconds: (at: Date, seconds: number) => new Date(+at + seconds * 1000) },
    federation: {
      createFlowState: async (input: object) => ({ ...input, id: 'flow' }),
      consumeFlowState: async () => null,
    },
  }),
}));

describe('federation protocol audit outside identity completion', () => {
  it('starts the real broker and emits the protocol event without root identity ports', async () => {
    const router = createFederationRouter('/oauth/authorize');
    const response = await router.request('/google/start');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://provider.test/authorize');
    expect(harness.rootAudit).not.toHaveBeenCalled();
    expect(harness.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'federation.start', provider: 'google' }), expect.any(String));
  });
  it('preserves a protocol refusal instead of replacing it with an unavailable-port failure', async () => {
    const response = await createFederationRouter('/oauth/authorize').request('/google/callback?state=state&code=code', {
      headers: { cookie: 'sentropic_fed_flow=missing' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'federation_flow_invalid' } });
    expect(harness.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'federation.flow_invalid' }), expect.any(String));
  });
});
