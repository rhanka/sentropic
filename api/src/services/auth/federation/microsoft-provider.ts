import { MicrosoftEntraId } from 'arctic';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import type { FederationProvider, FederationProviderIdentity } from './types';

const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
const MICROSOFT_JWKS_URL = new URL(
  `${MICROSOFT_LOGIN}/common/discovery/v2.0/keys`
);
const MICROSOFT_SCOPES = ['openid', 'profile', 'email'];
const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

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
  if (
    !['common', 'organizations', 'consumers'].includes(tenant) &&
    tenant !== normalizedTid
  ) {
    throw new Error(
      'Microsoft id_token tenant does not match the configured tenant.'
    );
  }
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
