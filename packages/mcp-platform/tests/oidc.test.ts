/**
 * Slice 2 — mock OIDC issuer probes (§6, §11 OIDC/MCP auth).
 */
import { describe, expect, it } from 'vitest';
import { MockOidcIssuer } from '../src/mock/oidc.js';

const AUD = 'https://rs.mcp.test';

function fresh(issuer: MockOidcIssuer) {
  return issuer.issue({ sub: 'user-1', aud: AUD, scope: ['widgets:read'], tid: 'tenant-a' });
}

describe('MockOidcIssuer', () => {
  it('publishes a JWKS with a public key only (no signing key disclosed)', () => {
    const issuer = new MockOidcIssuer();
    const jwks = issuer.jwks();
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0];
    expect(key.kty).toBe('OKP');
    expect(key.use).toBe('sig');
    // EdDSA public JWK exposes x but never the private scalar d.
    expect(key.x).toBeTruthy();
    expect(key.d).toBeUndefined();
  });

  it('accepts a valid audience-bound token', () => {
    const issuer = new MockOidcIssuer();
    const { token } = fresh(issuer);
    const r = issuer.verify(token, { expectedAudience: AUD, expectedIssuer: issuer.issuer });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.claims.sub).toBe('user-1');
      expect(r.claims.tid).toBe('tenant-a');
      expect(r.claims.scope).toBe('widgets:read');
    }
  });

  it('rejects a token bound to a different audience (fail-closed)', () => {
    const issuer = new MockOidcIssuer();
    const { token } = fresh(issuer);
    const r = issuer.verify(token, { expectedAudience: 'https://other.test', expectedIssuer: issuer.issuer });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('audience_mismatch');
  });

  it('rejects an issuer mismatch', () => {
    const issuer = new MockOidcIssuer();
    const { token } = fresh(issuer);
    const r = issuer.verify(token, { expectedAudience: AUD, expectedIssuer: 'https://evil.test' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('issuer_mismatch');
  });

  it('rejects a tampered signature', () => {
    const issuer = new MockOidcIssuer();
    const { token } = fresh(issuer);
    const [h, p] = token.split('.');
    const forged = `${h}.${p}.${'A'.repeat(86)}`;
    const r = issuer.verify(forged, { expectedAudience: AUD, expectedIssuer: issuer.issuer });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('bad_signature');
  });

  it('rejects a revoked token', () => {
    const issuer = new MockOidcIssuer();
    const { token, jti } = fresh(issuer);
    issuer.revoke(jti);
    const r = issuer.verify(token, { expectedAudience: AUD, expectedIssuer: issuer.issuer });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('revoked');
  });

  it('rejects an expired token', () => {
    const issuer = new MockOidcIssuer();
    const { token } = issuer.issue({
      sub: 'user-1',
      aud: AUD,
      scope: ['widgets:read'],
      tid: 'tenant-a',
      ttlSeconds: 60,
      now: 0,
    });
    const r = issuer.verify(token, {
      expectedAudience: AUD,
      expectedIssuer: issuer.issuer,
      now: 120_000,
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('expired');
  });
});
