import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';

import type { AuthHonoPorts } from '../ports.js';
import { sha256Base64url } from './crypto-utils.js';

export interface VerifyDpopProofOptions {
  accessToken?: string;
  htm: string;
  htu: string;
  iatSkewSeconds?: number;
  ports: AuthHonoPorts;
  proof: string;
}

export interface VerifiedDpopProof {
  jkt: string;
  jti: string;
}

export class OAuthDpopProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthDpopProofError';
  }
}

export const verifyOAuthDpopProof = async (
  options: VerifyDpopProofOptions
): Promise<VerifiedDpopProof> => {
  const header = decodeProtectedHeader(options.proof);
  const publicJwk = header.jwk as JWK | undefined;
  if (!publicJwk || !header.alg || header.typ !== 'dpop+jwt') {
    throw new OAuthDpopProofError('DPoP proof header is invalid.');
  }

  const key = await importJWK(publicJwk, header.alg);
  const { payload } = await jwtVerify(options.proof, key);
  await validateDpopPayload(payload, options);

  const expiresAt = options.ports.clock.addSeconds(
    options.ports.clock.now(),
    options.iatSkewSeconds ?? 60
  );
  const recorded = await options.ports.oauthStateStore.recordDpopJti(String(payload.jti), expiresAt);
  if (!recorded) {
    throw new OAuthDpopProofError('DPoP proof jti was already used.');
  }

  return {
    jkt: await calculateJwkThumbprint(publicJwk),
    jti: String(payload.jti),
  };
};

const validateDpopPayload = async (
  payload: JWTPayload,
  options: VerifyDpopProofOptions
): Promise<void> => {
  if (payload.htm !== options.htm.toUpperCase()) {
    throw new OAuthDpopProofError('DPoP htm claim does not match the request method.');
  }
  if (payload.htu !== options.htu) {
    throw new OAuthDpopProofError('DPoP htu claim does not match the request URL.');
  }
  if (!payload.jti || typeof payload.jti !== 'string') {
    throw new OAuthDpopProofError('DPoP jti claim is required.');
  }
  if (typeof payload.iat !== 'number') {
    throw new OAuthDpopProofError('DPoP iat claim is required.');
  }

  const nowSeconds = Math.floor(options.ports.clock.now().getTime() / 1000);
  if (Math.abs(payload.iat - nowSeconds) > (options.iatSkewSeconds ?? 60)) {
    throw new OAuthDpopProofError('DPoP iat claim is outside the allowed skew.');
  }

  if (options.accessToken) {
    await validateAth(payload, options.accessToken);
  }
};

const validateAth = async (payload: JWTPayload, accessToken: string): Promise<void> => {
  if (payload.ath !== (await sha256Base64url(accessToken))) {
    throw new OAuthDpopProofError('DPoP ath claim does not match the access token.');
  }
};
