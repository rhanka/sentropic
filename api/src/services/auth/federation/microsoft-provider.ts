import { MicrosoftEntraId } from 'arctic';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import type { FederationProvider, FederationProviderIdentity } from './types';

const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
const MICROSOFT_JWKS_URL = new URL(
  `${MICROSOFT_LOGIN}/common/discovery/v2.0/keys`
);
const MICROSOFT_SCOPES = ['openid', 'profile', 'email'];
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
// Matches an Entra tenant id (8-4-4-4-12 hex GUID). A configured `MICROSOFT_OAUTH_TENANT` that
// does not match this — and is not common/organizations/consumers — is a verified-domain form
// (e.g. "contoso.onmicrosoft.com").
const TENANT_GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let microsoftJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const getMicrosoftJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  microsoftJwks ??= createRemoteJWKSet(MICROSOFT_JWKS_URL);
  return microsoftJwks;
};

export type MicrosoftIdTokenVerifier = (
  idToken: string,
  audience: string
) => Promise<JWTPayload>;

const verifyMicrosoftIdToken: MicrosoftIdTokenVerifier = async (
  idToken,
  audience
) => {
  const { payload } = await jwtVerify(idToken, getMicrosoftJwks(), {
    audience,
  });
  return payload;
};

export interface MicrosoftProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
  /** Injectable for pure tests; production verifies the signature with Microsoft's rotating JWKS. */
  verifyIdToken?: MicrosoftIdTokenVerifier;
}

const requiredClaim = (payload: JWTPayload, claim: 'oid' | 'tid'): string => {
  const value = payload[claim];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Microsoft id_token is missing the ${claim} claim.`);
  }
  return value;
};

const enforceTenantPolicy = (
  payload: JWTPayload,
  configuredTenant: string
): string => {
  const tid = requiredClaim(payload, 'tid');
  const expectedIssuer = `${MICROSOFT_LOGIN}/${tid}/v2.0`;
  if (
    typeof payload.iss !== 'string' ||
    payload.iss.toLowerCase() !== expectedIssuer.toLowerCase()
  ) {
    throw new Error(
      'Microsoft id_token issuer does not match its tenant claim.'
    );
  }

  const tenant = configuredTenant.trim().toLowerCase();
  const normalizedTid = tid.toLowerCase();
  if (
    tenant === 'organizations' &&
    normalizedTid === MICROSOFT_CONSUMER_TENANT
  ) {
    throw new Error(
      'Microsoft personal accounts are not allowed by the configured tenant policy.'
    );
  }
  if (tenant === 'consumers' && normalizedTid !== MICROSOFT_CONSUMER_TENANT) {
    throw new Error(
      'Microsoft organization accounts are not allowed by the configured tenant policy.'
    );
  }
  const isSpecialTenant = ['common', 'organizations', 'consumers'].includes(
    tenant
  );
  if (
    !isSpecialTenant &&
    TENANT_GUID_PATTERN.test(tenant) &&
    tenant !== normalizedTid
  ) {
    throw new Error(
      'Microsoft id_token tenant does not match the configured tenant.'
    );
  }
  // A verified-domain configured tenant (not common/organizations/consumers, and not a GUID —
  // e.g. "contoso.onmicrosoft.com") is a documented-valid `MICROSOFT_OAUTH_TENANT` value, but
  // Microsoft's `tid` claim is ALWAYS the tenant GUID, never the domain name. A literal
  // `tid === tenant` comparison could therefore never succeed for a domain-form tenant, which
  // would deterministically reject every login. The issuer check above already proves the token
  // was issued for tenant `tid` (`iss` embeds that GUID) — combined with Microsoft only issuing
  // tokens off the tenant-scoped authorize endpoint, that is the binding guarantee available for
  // a domain-form tenant, so the literal comparison is intentionally skipped here.
  return tid;
};

export const createMicrosoftProvider = (
  config: MicrosoftProviderConfig
): FederationProvider => {
  const tenant = config.tenant.trim() || 'common';
  const microsoft = new MicrosoftEntraId(
    tenant,
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );
  const verifyIdToken = config.verifyIdToken ?? verifyMicrosoftIdToken;

  return {
    id: 'microsoft',

    createAuthorizationUrl({ codeVerifier, nonce, state }) {
      const url = microsoft.createAuthorizationURL(
        state,
        codeVerifier,
        MICROSOFT_SCOPES
      );
      url.searchParams.set('nonce', nonce);
      return url.toString();
    },

    async verifyCallback({
      code,
      codeVerifier,
      nonce,
    }): Promise<FederationProviderIdentity> {
      const tokens = await microsoft.validateAuthorizationCode(
        code,
        codeVerifier ?? ''
      );
      const payload = await verifyIdToken(tokens.idToken(), config.clientId);

      if (!nonce || payload.nonce !== nonce) {
        throw new Error('Microsoft id_token nonce missing or mismatch.');
      }

      const providerTenant = enforceTenantPolicy(payload, tenant);
      const subject = requiredClaim(payload, 'oid');
      const email =
        typeof payload.email === 'string'
          ? payload.email
          : typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : null;

      return {
        email,
        emailVerified: payload.email_verified === true,
        providerTenant,
        subject,
      };
    },
  };
};
