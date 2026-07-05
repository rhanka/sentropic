/**
 * Slice 2 — In-memory mock OIDC issuer.
 *
 * Mocks the authorization-server side just enough to exercise the resource-server
 * platform contract (SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §6, §11):
 * - EdDSA-signed JWTs carrying sub / aud / scope / auth_time / tid;
 * - a published public JWKS;
 * - a revocation list.
 *
 * MOCK-ONLY: uses Node's built-in `crypto` only — no external dependency, no
 * network, no production credentials. The signing key never leaves this process
 * and is never exposed via the JWKS (only the public key is).
 */
import {
  type KeyObject,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export type MockTokenClaims = {
  iss: string;
  sub: string;
  aud: string; // RFC 8707-style audience binding to the MCP resource server
  scope: string; // space-delimited OAuth scopes
  auth_time: number; // seconds since epoch (freshness source, §6.5)
  tid: string; // tenant id — the ONLY authoritative tenant source
  iat: number;
  exp: number;
  jti: string;
  acr?: string;
  amr?: string[];
  // Custom claims (e.g. role/assurance markers) gating capabilities via
  // `requiredClaims` (§4.3). Standard claims above always win over custom ones.
  [claim: string]: unknown;
};

export type IssueOptions = {
  sub: string;
  aud: string;
  scope: string[];
  tid: string;
  authTimeSeconds?: number; // defaults to now
  ttlSeconds?: number; // defaults to 3600
  acr?: string;
  amr?: string[];
  claims?: Record<string, unknown>; // extra custom claims (e.g. requiredClaims gates)
  now?: number; // injectable clock (ms), defaults to Date.now()
};

export type VerifyOptions = {
  expectedAudience: string;
  expectedIssuer: string;
  now?: number; // injectable clock (ms)
};

export type VerifyResult =
  | { valid: true; claims: MockTokenClaims }
  | { valid: false; reason: VerifyFailure };

export type VerifyFailure =
  | 'malformed'
  | 'bad_signature'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'expired'
  | 'revoked';

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

const decodeJson = <T>(segment: string): T =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;

export class MockOidcIssuer {
  readonly issuer: string;
  readonly #privateKey: KeyObject;
  readonly #publicKey: KeyObject;
  readonly #kid: string;
  readonly #revoked = new Set<string>(); // revoked jti values

  constructor(issuer = 'https://mock-issuer.test') {
    this.issuer = issuer;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
    this.#kid = randomUUID();
  }

  /** Published JWKS — public key only; the signing key is never disclosed. */
  jwks(): { keys: Array<Record<string, unknown>> } {
    const jwk = this.#publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    return { keys: [{ ...jwk, kid: this.#kid, alg: 'EdDSA', use: 'sig' }] };
  }

  /** Issue an EdDSA-signed JWT. Returns the compact token and its jti. */
  issue(opts: IssueOptions): { token: string; jti: string; claims: MockTokenClaims } {
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const jti = randomUUID();
    const claims: MockTokenClaims = {
      // Custom claims first so the authoritative standard claims always win.
      ...(opts.claims ?? {}),
      iss: this.issuer,
      sub: opts.sub,
      aud: opts.aud,
      scope: opts.scope.join(' '),
      auth_time: opts.authTimeSeconds ?? nowSec,
      tid: opts.tid,
      iat: nowSec,
      exp: nowSec + (opts.ttlSeconds ?? 3600),
      jti,
      ...(opts.acr ? { acr: opts.acr } : {}),
      ...(opts.amr ? { amr: opts.amr } : {}),
    };
    const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: this.#kid }));
    const payload = b64url(JSON.stringify(claims));
    const signingInput = `${header}.${payload}`;
    const signature = b64url(cryptoSign(null, Buffer.from(signingInput), this.#privateKey));
    return { token: `${signingInput}.${signature}`, jti, claims };
  }

  /** Revoke a token by its jti. Subsequent verifies fail closed with 'revoked'. */
  revoke(jti: string): void {
    this.#revoked.add(jti);
  }

  isRevoked(jti: string): boolean {
    return this.#revoked.has(jti);
  }

  /** Verify a token: signature, issuer, audience binding, expiry, revocation. */
  verify(token: string, opts: VerifyOptions): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed' };
    const [header, payload, signature] = parts;
    let claims: MockTokenClaims;
    try {
      claims = decodeJson<MockTokenClaims>(payload);
    } catch {
      return { valid: false, reason: 'malformed' };
    }
    const signingInput = `${header}.${payload}`;
    const ok = cryptoVerify(
      null,
      Buffer.from(signingInput),
      this.#publicKey,
      Buffer.from(signature, 'base64url'),
    );
    if (!ok) return { valid: false, reason: 'bad_signature' };
    if (claims.iss !== opts.expectedIssuer) return { valid: false, reason: 'issuer_mismatch' };
    if (claims.aud !== opts.expectedAudience) return { valid: false, reason: 'audience_mismatch' };
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    if (claims.exp <= nowSec) return { valid: false, reason: 'expired' };
    if (this.#revoked.has(claims.jti)) return { valid: false, reason: 'revoked' };
    return { valid: true, claims };
  }
}
