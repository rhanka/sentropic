import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CmAuthBindingConfig } from '../../../src/services/identity/cm-auth-binding';
import { cmEmailHandlers } from '../../../src/routes/namespaces/auth/cm-email';
import { loadCmDeletionOptions } from '../../../src/services/identity/cm-deletion-options';

const harness = vi.hoisted(() => ({ config: null as CmAuthBindingConfig | null, issue: vi.fn() }));
vi.mock('../../../src/routes/auth/oauth', () => ({
  createSentropicOAuthHostPorts: vi.fn(), createSentropicOAuthStateCodec: () => ({}),
  resolveSessionTokenSecret: () => 'synthetic-idp-session-key',
  getSentropicOAuthPorts: () => ({ accountPolicy: {} }),
}));
vi.mock('../../../src/services/identity/cm-token-secrets', () => ({ resolveEmailVerificationTokenSecret: () => 'synthetic-ticket-key' }));
vi.mock('../../../src/services/webauthn-config', () => ({ getWebAuthnConfig: () => ({
  rpID: 'sent-tech.ca', rpName: 'Sentropic', origin: 'https://preprod.auth.sent-tech.ca',
  timeout: { registration: 1000, authentication: 1000 },
}) }));
vi.mock('../../../src/services/identity/cm-auth-workspace', () => ({ provisionCmAuthWorkspace: vi.fn() }));
vi.mock('../../../src/services/identity/cm-auth-mail', () => ({ sendCmDeferredMail: vi.fn() }));
vi.mock('../../../src/services/identity/cm-host-scope', () => ({ assertCmHostHealthy: vi.fn() }));
vi.mock('../../../src/services/identity/cm-auth-binding', () => ({
  createCmAuthRequestRunner: (config: CmAuthBindingConfig) => {
    harness.config = config;
    return { complete: async (_flow: string, work: (binding: unknown, tx: unknown) => Promise<unknown>) => ({
      committed: true, value: await work({ emailVerification: { requestEmailCode: harness.issue } }, { hostTransaction: {} }),
    }) };
  },
}));

const keyRef = 'email-code-hmac:v1:preprod:synthetic-test-ring';
const request = () => new Hono().post('/api/v1/auth/email/verify-request', cmEmailHandlers.requestEmailCode!)
  .request('https://preprod.auth.sent-tech.ca/api/v1/auth/email/verify-request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'operator@example.test' }),
  });
beforeEach(() => {
  harness.config = null; harness.issue.mockReset();
  harness.issue.mockResolvedValue({ success: true, expiresAt: new Date('2026-11-06T00:00:00Z') });
  vi.stubEnv('CM_IDENTITY_EMAIL_CODE_POLICY', 'hmac-sha256');
  vi.stubEnv('CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF', 'qk-secret-custody-r2:Q-K=A:2026-11-02');
  vi.stubEnv('CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF', keyRef);
  vi.stubEnv('CM_IDENTITY_EMAIL_CODE_KEYS_JSON', JSON.stringify({ [keyRef]: Buffer.alloc(32, 0x11).toString('base64url') }));
  vi.stubEnv('CM_IDENTITY_EMAIL_CODE_PREVIOUS_KEY_REFS_JSON', '[]');
});
afterEach(() => vi.unstubAllEnvs());

it('should load the real HMAC policy on the IdP shared CM email request path', async () => {
  expect((await request()).status).toBe(200);
  expect(harness.issue).toHaveBeenCalledWith({ email: 'operator@example.test' });
  expect(harness.config?.emailCodeKeys).toEqual({ issuance: 'hmac-sha256', activeKeyRef: keyRef, previousKeyRefs: [] });
  expect(harness.config?.rp.expectedOrigins).toEqual(['https://preprod.auth.sent-tech.ca']);
  expect(loadCmDeletionOptions().deletion.deadlineMs).toBeGreaterThan(0);
});
it.each(['CM_IDENTITY_EMAIL_CODE_POLICY', 'CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF', 'CM_IDENTITY_EMAIL_CODE_KEYS_JSON'])(
  'should refuse the IdP CM request before transaction entry when %s is absent', async name => {
    vi.stubEnv(name, undefined);
    expect((await request()).status).toBe(503);
    expect(harness.config).toBeNull(); expect(harness.issue).not.toHaveBeenCalled();
  });
it('should refuse account-deletion budgets when the qualified Secret input is missing', () => {
  vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', undefined);
  expect(() => loadCmDeletionOptions()).toThrow();
});
