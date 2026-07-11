import { Apple } from 'arctic';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

import type { FederationProvider, FederationProviderIdentity } from './types';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL(`${APPLE_ISSUER}/auth/keys`);
const APPLE_SCOPES = ['name', 'email'];
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const getAppleJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  appleJwks ??= createRemoteJWKSet(APPLE_JWKS_URL);
  return appleJwks;
};

export interface AppleClientSecretInput {
  clientId: string;
  keyId: string;
  privateKeyPem: string;
  teamId: string;
  now?: number;
}

/** Mint Apple's short-lived OAuth client_secret without reading env or retaining key material. */
export async function mintAppleClientSecret(input: AppleClientSecretInput): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const key = await importPKCS8(input.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId })
    .setIssuer(input.teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + CLIENT_SECRET_TTL_SECONDS)
    .setAudience(APPLE_ISSUER)
    .setSubject(input.clientId)
    .sign(key);
}

const pkcs8Bytes = (pem: string): Uint8Array => {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem);
  if (!match) throw new Error('Apple private key must be PKCS#8 PEM.');
  return Uint8Array.from(Buffer.from(match[1].replace(/\s/g, ''), 'base64'));
};

export const isApplePrivateRelayEmail = (email: string): boolean =>
  email.trim().toLowerCase().endsWith('@privaterelay.appleid.com');

interface AppleClient {
  createAuthorizationURL(state: string, scopes: string[]): URL;
  validateAuthorizationCode(code: string): Promise<{ idToken(): string }>;
}

export interface AppleProviderConfig {
  clientId: string;
  keyId: string;
  privateKeyPem: string;
  redirectUri: string;
  teamId: string;
  /** Test seams only; production uses Arctic and Apple's remote JWKS. */
  client?: AppleClient;
  verificationKey?: CryptoKey;
}

export const createAppleProvider = (config: AppleProviderConfig): FederationProvider => {
  // Arctic 3.7 accepts raw PKCS#8 bytes and mints its own five-minute client secret internally.
  const apple =
    config.client ??
    new Apple(config.clientId, config.teamId, config.keyId, pkcs8Bytes(config.privateKeyPem), config.redirectUri);

  return {
    id: 'apple',

    createAuthorizationUrl({ nonce, state }) {
      const url = apple.createAuthorizationURL(state, APPLE_SCOPES);
      url.searchParams.set('response_mode', 'form_post');
      url.searchParams.set('nonce', nonce);
      return url.toString();
    },

    async verifyCallback({ code, nonce, profile }): Promise<FederationProviderIdentity> {
      const idToken = (await apple.validateAuthorizationCode(code)).idToken();
      const options = { audience: config.clientId, issuer: APPLE_ISSUER };
      const verified = config.verificationKey
        ? await jwtVerify(idToken, config.verificationKey, options)
        : await jwtVerify(idToken, getAppleJwks(), options);
      const payload = verified.payload;

      if (!nonce || payload.nonce !== nonce) {
        throw new Error('Apple id_token nonce missing or mismatch.');
      }
      const subject = typeof payload.sub === 'string' ? payload.sub : null;
      if (!subject) throw new Error('Apple id_token is missing the subject claim.');

      const tokenEmail = typeof payload.email === 'string' ? payload.email : null;
      if (tokenEmail && profile?.email && tokenEmail.toLowerCase() !== profile.email.toLowerCase()) {
        throw new Error('Apple callback profile email does not match the id_token.');
      }
      const email = tokenEmail ?? profile?.email ?? null;
      const emailVerified = Boolean(tokenEmail) &&
        (payload.email_verified === true || payload.email_verified === 'true');

      return {
        displayName: profile?.displayName ?? null,
        email,
        emailScope: email && isApplePrivateRelayEmail(email) ? 'provider' : 'global',
        emailVerified,
        subject,
      };
    },
  };
};
