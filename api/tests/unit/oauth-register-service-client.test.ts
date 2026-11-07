/**
 * Governed client_credentials service-client provisioner: pure env parser and planner.
 * No DB: the script performs its CM write only when invoked directly.
 */
import { describe, expect, it } from 'vitest';

import {
  buildServiceClientRegistration,
  hashServiceClientSecret,
  planServiceClientProvisioning,
  rotationDueAt,
  type ProvisioningState,
} from '../../src/services/auth/service-client-provisioning';

const SECRET = 'a'.repeat(20) + 'B'.repeat(20) + '0123456789';
const env: NodeJS.ProcessEnv = {
  AUTH_CALLBACK_BASE_URL: 'https://preprod.sentropic.sent-tech.ca/',
  OAUTH_SERVICE_CLIENT_ID: 'immo-preprod-host',
  OAUTH_SERVICE_CLIENT_SCOPES: 'github-app:broker, artifacts:builder',
  OAUTH_SERVICE_CLIENT_SECRET: SECRET,
};
const desired = (extra: NodeJS.ProcessEnv = {}) => buildServiceClientRegistration({ ...env, ...extra });
const TENANT = { status: 'active', tenantId: 't-sentropic' };
const stored = (extra: Partial<NonNullable<ProvisioningState['stored']>> = {}) => ({
  allowedScopes: ['github-app:broker', 'artifacts:builder'],
  clientSecretHash: hashServiceClientSecret(SECRET),
  displayName: 'immo-preprod-host',
  dpopBoundAccessTokens: false,
  exchangePolicy: null,
  resourceIndicators: ['https://preprod.sentropic.sent-tech.ca'],
  revokedAt: null,
  ...extra,
});
const state = (extra: Partial<ProvisioningState> = {}): ProvisioningState => ({
  binding: { tenantId: TENANT.tenantId }, oauthClientCollision: false, stored: stored(), tenant: TENANT, ...extra,
});

describe('buildServiceClientRegistration', () => {
  it('hashes the secret with sha256 and never keeps the plaintext', () => {
    const values = desired();
    expect(values.clientSecretHash).toBe(hashServiceClientSecret(SECRET));
    expect(values.clientSecretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(values)).not.toContain(SECRET);
    expect(values).toMatchObject({ clientId: 'immo-preprod-host', displayName: 'immo-preprod-host', tenantSlug: 'sentropic' });
    expect(values.allowedScopes).toEqual(['github-app:broker', 'artifacts:builder']);
  });

  it('defaults the resource to OAUTH_SERVICE_RESOURCE_URI, else the issuer AUTH_CALLBACK_BASE_URL', () => {
    expect(desired().resourceIndicators).toEqual(['https://preprod.sentropic.sent-tech.ca']);
    expect(desired({ OAUTH_SERVICE_RESOURCE_URI: 'https://api.example.com/' }).resourceIndicators)
      .toEqual(['https://api.example.com']);
    expect(desired({ OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS: 'https://a.example.com, https://b.example.com/x' })
      .resourceIndicators).toEqual(['https://a.example.com', 'https://b.example.com/x']);
    expect(() => desired({ AUTH_CALLBACK_BASE_URL: '' })).toThrow(/No resource indicator/);
  });

  it('refuses unknown, empty and OIDC scopes', () => {
    for (const scopes of ['', 'openid', 'artifacts:builder,immo:search', 'service:read']) {
      expect(() => desired({ OAUTH_SERVICE_CLIENT_SCOPES: scopes })).toThrow(/OAUTH_SERVICE_CLIENT_SCOPES|unknown service scopes/);
    }
  });

  it('refuses weak secrets, bad ids, the reserved workload id and insecure resources', () => {
    for (const secret of ['', 'short', `${SECRET} `, `dev-only-${SECRET}`]) {
      expect(() => desired({ OAUTH_SERVICE_CLIENT_SECRET: secret })).toThrow(/OAUTH_SERVICE_CLIENT_SECRET/);
    }
    for (const id of ['', 'A-upper', 'x', 'has space']) {
      expect(() => desired({ OAUTH_SERVICE_CLIENT_ID: id })).toThrow(/OAUTH_SERVICE_CLIENT_ID/);
    }
    expect(() => desired({ OAUTH_SERVICE_CLIENT_ID: 'immo-mcp-workload' })).toThrow(/reserved/);
    for (const uri of ['http://api.example.com', 'https://localhost:8787', 'https://a.example.com#x', 'not a uri']) {
      expect(() => desired({ OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS: uri })).toThrow(/invalid resource/);
    }
  });

  it('accepts only "true" or "false" for flags', () => {
    expect(desired({ OAUTH_SERVICE_CLIENT_DPOP: 'true' }).dpopBoundAccessTokens).toBe(true);
    expect(() => desired({ OAUTH_SERVICE_CLIENT_ALLOW_WIDEN: 'yes' })).toThrow(/ALLOW_WIDEN/);
  });
});

describe('planServiceClientProvisioning', () => {
  it('creates and binds a new client, then replays as a no-op', () => {
    expect(planServiceClientProvisioning(desired(), state({ binding: null, stored: null })))
      .toEqual({ action: 'create', bindTenant: true, changes: ['created'], rotateSecret: false });
    expect(planServiceClientProvisioning(desired({ OAUTH_SERVICE_CLIENT_SCOPES: 'artifacts:builder,github-app:broker' }), state()))
      .toEqual({ action: 'noop', bindTenant: false, changes: [], rotateSecret: false });
  });

  it('refuses to widen or downgrade without the explicit flag', () => {
    const wider = { OAUTH_SERVICE_CLIENT_SCOPES: 'github-app:broker,artifacts:builder,service:ping' };
    expect(() => planServiceClientProvisioning(desired(wider), state())).toThrow(/widen .*\+scope service:ping/);
    expect(planServiceClientProvisioning(desired({ ...wider, OAUTH_SERVICE_CLIENT_ALLOW_WIDEN: 'true' }), state()).changes)
      .toEqual(['+scope service:ping']);
    const narrower = { OAUTH_SERVICE_CLIENT_SCOPES: 'artifacts:builder' };
    expect(() => planServiceClientProvisioning(desired(narrower), state())).toThrow(/downgrade .*-scope github-app:broker/);
    expect(() => planServiceClientProvisioning(desired(narrower), state())).not.toThrow(/widen/);
    expect(() => planServiceClientProvisioning(desired({ OAUTH_SERVICE_CLIENT_DPOP: 'true' }), state())).toThrow(/downgrade .*\+dpop/);
    expect(() => planServiceClientProvisioning(desired(), state({ stored: stored({ dpopBoundAccessTokens: true }) })))
      .toThrow(/widen .*-dpop/);
    expect(() => planServiceClientProvisioning(desired(), state({ stored: stored({ resourceIndicators: ['https://x.example.com'] }) })))
      .toThrow(/widen .*\+resource https:\/\/preprod/);
  });

  it('rotates the secret only with OAUTH_SERVICE_CLIENT_ROTATE_SECRET=true', () => {
    const old = state({ stored: stored({ clientSecretHash: hashServiceClientSecret(`${SECRET}-old`) }) });
    expect(() => planServiceClientProvisioning(desired(), old)).toThrow(/ROTATE_SECRET/);
    expect(planServiceClientProvisioning(desired({ OAUTH_SERVICE_CLIENT_ROTATE_SECRET: 'true' }), old))
      .toEqual({ action: 'update', bindTenant: false, changes: ['secret rotated'], rotateSecret: true });
  });

  it('refuses revoked, exchange-policy, colliding, rebound and inactive-tenant states', () => {
    const cases: [Partial<ProvisioningState>, RegExp][] = [
      [{ stored: stored({ revokedAt: new Date() }) }, /revoked/],
      [{ stored: stored({ exchangePolicy: { enabled: true } }) }, /token-exchange policy/],
      [{ oauthClientCollision: true }, /oauth_clients/],
      [{ binding: { tenantId: 't-other' } }, /another tenant/],
      [{ tenant: null }, /does not exist/],
      [{ tenant: { status: 'suspended', tenantId: TENANT.tenantId } }, /not active/],
    ];
    for (const [extra, refusal] of cases) {
      expect(() => planServiceClientProvisioning(desired(), state(extra))).toThrow(refusal);
    }
  });

  it('binds a missing tenant binding on an existing row', () => {
    expect(planServiceClientProvisioning(desired(), state({ binding: null })))
      .toEqual({ action: 'update', bindTenant: true, changes: ['tenant binding'], rotateSecret: false });
  });

  it('computes the 90-day rotation due date from the last rotation, else creation', () => {
    const created = new Date('2026-11-07T00:00:00Z');
    expect(rotationDueAt(created, null).toISOString()).toBe('2027-02-05T00:00:00.000Z');
    expect(rotationDueAt(created, new Date('2027-01-01T00:00:00Z')).toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });
});
