/**
 * Slice 2 — per-request authz / tenant-isolation probes (§6, §7.1, §11).
 *
 * Covers: cross-tenant denial, deny-as-missing discovery, fail-closed ambiguous
 * mapping, revoked/missing consent, max_age fresh/stale step-up, insufficient
 * scope, and token no-passthrough.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryConsentRegistry,
  InMemoryTenantRegistry,
  authorizeRequest,
  type AuthorizeDeps,
  type AuthzRequest,
} from '../src/authz.js';
import { listVisibleCapabilities } from '../src/visibility.js';
import { MockOidcIssuer } from '../src/mock/oidc.js';
import { fakeManifest } from '../src/mock/fake-connector.js';
import type { AppCapability } from '../src/manifest.js';

const AUD = 'https://rs.mcp.test';
const CONN = 'conn-1';
const T = 2_000_000_000_000; // fixed clock (ms)

const caps = new Map<string, AppCapability>([
  [fakeManifest.resources[0].name, fakeManifest.resources[0]],
  [fakeManifest.tools[0].name, fakeManifest.tools[0]],
]);

function buildDeps(): { deps: AuthorizeDeps; tenants: InMemoryTenantRegistry; consents: InMemoryConsentRegistry; issuer: MockOidcIssuer } {
  const issuer = new MockOidcIssuer();
  const tenants = new InMemoryTenantRegistry();
  const consents = new InMemoryConsentRegistry();
  tenants.enroll('user-1', CONN, 'tenant-a');
  tenants.mapDomainHint('businessId', 'B-other', 'tenant-b');
  consents.grant({
    id: 'grant-1',
    principalSub: 'user-1',
    tenantRef: 'tenant-a',
    connectorInstanceId: CONN,
    scopes: ['widgets:read', 'widgets:write'],
    state: 'active',
    grantedAt: new Date(T).toISOString(),
  });
  const deps: AuthorizeDeps = {
    issuer,
    resourceAudience: AUD,
    expectedIssuer: issuer.issuer,
    capabilities: caps,
    tenantResolver: tenants,
    consentResolver: consents,
  };
  return { deps, tenants, consents, issuer };
}

function tokenFor(issuer: MockOidcIssuer, scope: string[], tid = 'tenant-a', authNow = T) {
  return issuer.issue({ sub: 'user-1', aud: AUD, scope, tid, authTimeSeconds: Math.floor(authNow / 1000), now: T }).token;
}

describe('authorizeRequest — tenant isolation & freshness', () => {
  it('allows a valid, scoped, consented, tenant-matched read', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = { token: tokenFor(issuer, ['widgets:read']), capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T };
    const r = await authorizeRequest(req, deps);
    const next = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(true);
    expect(next.allowed).toBe(true);
    if (r.allowed) expect(r.tenantContext.tenantRef).toBe('tenant-a');
  });

  it('derives tenant from the TOKEN, ignoring a benign same-tenant hint', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = {
      token: tokenFor(issuer, ['widgets:read']),
      capabilityRef: 'list_widgets',
      connectorInstanceId: CONN,
      selectorHints: { tenantId: 'tenant-a' },
      now: T,
    };
    const r = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.tenantContext.tenantRef).toBe('tenant-a');
  });

  it('verifies the token before invoking the tenant resolver', async () => {
    const { deps } = buildDeps();
    let resolverCalled = false;
    deps.tenantResolver = {
      authorizedTenants: async () => {
        resolverCalled = true;
        return [];
      },
      tenantOfDomainHint: async () => {
        resolverCalled = true;
        return undefined;
      },
    };

    const result = await authorizeRequest(
      { token: 'invalid', capabilityRef: 'list_widgets', connectorInstanceId: CONN, selectorHints: { businessId: 'B-other' }, now: T },
      deps,
    );
    expect(result).toMatchObject({ allowed: false, reason: 'invalid_token' });
    expect(resolverCalled).toBe(false);
  });

  it('initiates enrollment and all present domain-hint resolutions concurrently', async () => {
    const { deps, issuer } = buildDeps();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    deps.tenantResolver = {
      authorizedTenants: async () => {
        calls.push('authorized');
        await gate;
        return ['tenant-a'];
      },
      tenantOfDomainHint: async (key, value) => {
        calls.push(`${key}:${value}`);
        await gate;
        return 'tenant-a';
      },
    };

    const authorization = authorizeRequest(
      {
        token: tokenFor(issuer, ['widgets:read']),
        capabilityRef: 'list_widgets',
        connectorInstanceId: CONN,
        selectorHints: { businessId: 'business-1', workspaceId: 'workspace-1' },
        now: T,
      },
      deps,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['workspaceId:workspace-1', 'businessId:business-1', 'authorized']);
    release();
    expect((await authorization).allowed).toBe(true);
  });

  it('denies a spoofed cross-tenant id hint (token tenant-a, hint tenant-b)', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = {
      token: tokenFor(issuer, ['widgets:read']),
      capabilityRef: 'list_widgets',
      connectorInstanceId: CONN,
      selectorHints: { tenantId: 'tenant-b' },
      now: T,
    };
    const r = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('cross_tenant');
  });

  it('denies a spoofed cross-tenant DOMAIN hint (businessId mapped to another tenant)', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = {
      token: tokenFor(issuer, ['widgets:read']),
      capabilityRef: 'list_widgets',
      connectorInstanceId: CONN,
      selectorHints: { businessId: 'B-other' },
      now: T,
    };
    const r = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('cross_tenant');
  });

  it('fails closed on ambiguous mapping (conflicting tenant hints)', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = {
      token: tokenFor(issuer, ['widgets:read']),
      capabilityRef: 'list_widgets',
      connectorInstanceId: CONN,
      selectorHints: { tenantId: 'tenant-a', businessId: 'B-other' }, // a vs b
      now: T,
    };
    const r = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('ambiguous_tenant');
  });

  it('denies missing scope with insufficient_scope (scope step-up)', async () => {
    const { deps, issuer } = buildDeps();
    const req: AuthzRequest = { token: tokenFor(issuer, ['widgets:read']), capabilityRef: 'create_widget', connectorInstanceId: CONN, now: T };
    const r = await authorizeRequest(req, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('insufficient_scope');
      expect(r.stepUp).toBe('scope');
      expect(r.wwwAuthenticate).toContain('insufficient_scope');
    }
  });

  it('allows a fresh write but denies a stale one with an auth step-up', async () => {
    const { deps, issuer } = buildDeps();
    const freshReq: AuthzRequest = { token: tokenFor(issuer, ['widgets:write'], 'tenant-a', T), capabilityRef: 'create_widget', connectorInstanceId: CONN, now: T + 100_000 };
    expect((await authorizeRequest(freshReq, deps)).allowed).toBe(true);

    const staleReq: AuthzRequest = { token: tokenFor(issuer, ['widgets:write'], 'tenant-a', T), capabilityRef: 'create_widget', connectorInstanceId: CONN, now: T + 400_000 };
    const r = await authorizeRequest(staleReq, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('stale_auth');
      expect(r.stepUp).toBe('auth');
    }
  });

  it('denies revoked consent and missing consent', async () => {
    const { deps, consents, tenants, issuer } = buildDeps();
    consents.setState('grant-1', 'revoked');
    const revoked = await authorizeRequest({ token: tokenFor(issuer, ['widgets:read']), capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T }, deps);
    expect(revoked.allowed).toBe(false);
    if (!revoked.allowed) expect(revoked.reason).toBe('consent_revoked');

    // A different principal, enrolled in the tenant but never consented.
    tenants.enroll('user-2', CONN, 'tenant-a');
    const t2 = issuer.issue({ sub: 'user-2', aud: AUD, scope: ['widgets:read'], tid: 'tenant-a', now: T }).token;
    const missing = await authorizeRequest({ token: t2, capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T }, deps);
    expect(missing.allowed).toBe(false);
    if (!missing.allowed) expect(missing.reason).toBe('no_consent');
  });

  it('F1: an unenrolled principal (empty authorized set) is denied fail-closed (no broad fallback)', async () => {
    const { deps, issuer } = buildDeps();
    // 'stranger' is never enrolled on this connector → authorizedTenants() is empty.
    const tok = issuer.issue({ sub: 'stranger', aud: AUD, scope: ['widgets:read'], tid: 'tenant-a', now: T }).token;
    const r = await authorizeRequest({ token: tok, capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T }, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('no_enrollment');
  });

  it('F2: a claim-gated capability is allowed with the claim and denied without it', async () => {
    const { deps, issuer } = buildDeps();
    const claimGated: AppCapability = { ...fakeManifest.resources[0], name: 'list_secure', requiredClaims: ['mfa'] };
    const depsClaim = { ...deps, capabilities: new Map(deps.capabilities).set('list_secure', claimGated) };

    const withClaim = issuer.issue({
      sub: 'user-1', aud: AUD, scope: ['widgets:read'], tid: 'tenant-a', claims: { mfa: true }, now: T,
    }).token;
    expect(
      (await authorizeRequest({ token: withClaim, capabilityRef: 'list_secure', connectorInstanceId: CONN, now: T }, depsClaim)).allowed,
    ).toBe(true);

    const withoutClaim = tokenFor(issuer, ['widgets:read']);
    const r = await authorizeRequest({ token: withoutClaim, capabilityRef: 'list_secure', connectorInstanceId: CONN, now: T }, depsClaim);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('missing_claims');
  });

  it('rejects a non-audience-bound token and never passes it through (token no-passthrough §6.6)', async () => {
    const { deps, issuer } = buildDeps();
    const wrongAud = issuer.issue({ sub: 'user-1', aud: 'https://elsewhere.test', scope: ['widgets:read'], tid: 'tenant-a', now: T }).token;
    const r = await authorizeRequest({ token: wrongAud, capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T }, deps);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('invalid_token');
      expect(r.tokenFailure).toBe('audience_mismatch');
      expect(r.wwwAuthenticate).toContain('invalid_token');
    }
    // The decision object never carries the raw inbound token downstream.
    expect(JSON.stringify(r)).not.toContain(wrongAud);
  });

  it('F7: the authorized decision structurally omits the bearer token (no passthrough §6.6)', async () => {
    const { deps, issuer } = buildDeps();
    const token = tokenFor(issuer, ['widgets:read']);
    const r = await authorizeRequest({ token, capabilityRef: 'list_widgets', connectorInstanceId: CONN, now: T }, deps);
    expect(r.allowed).toBe(true);
    // The token field is structurally absent from the result (and the principal),
    // not merely missing on the deny path.
    expect('token' in (r as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(token);
    if (r.allowed) expect('token' in (r.principal as Record<string, unknown>)).toBe(false);
  });
});

describe('listVisibleCapabilities — deny-as-missing discovery (§7.1)', () => {
  it('omits capabilities the principal lacks scope for (absent, not "denied")', () => {
    const visible = listVisibleCapabilities([...caps.values()], {
      scopes: ['widgets:read'],
      claims: [],
      tenantRef: 'tenant-a',
      accessibleTenants: ['tenant-a'],
    });
    expect(visible.map((c) => c.name)).toEqual(['list_widgets']);
    expect(visible.map((c) => c.name)).not.toContain('create_widget');
  });

  it('leaks nothing when the tenant is not accessible', () => {
    const visible = listVisibleCapabilities([...caps.values()], {
      scopes: ['widgets:read', 'widgets:write'],
      claims: [],
      tenantRef: 'tenant-x',
      accessibleTenants: ['tenant-a'],
    });
    expect(visible).toHaveLength(0);
  });
});
