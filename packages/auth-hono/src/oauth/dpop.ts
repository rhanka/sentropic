import {
  DpopVerifyError,
  verifyDpopProof,
  type VerifiedDpop,
} from '@sentropic/oauth-verify';

import type { AuthHonoPorts } from '../ports.js';

export interface VerifyDpopProofOptions {
  accessToken?: string;
  htm: string;
  htu: string;
  iatSkewSeconds?: number;
  ports: AuthHonoPorts;
  proof: string;
}

export type VerifiedDpopProof = VerifiedDpop;

export class OAuthDpopProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthDpopProofError';
  }
}

/**
 * AS-side DPoP proof verification. Thin adapter over `@sentropic/oauth-verify`'s shared
 * `verifyDpopProof`: it binds the IdP's clock + replay store and re-maps verification
 * failures onto `OAuthDpopProofError` for the OAuth handlers (token/userinfo/revoke).
 */
export const verifyOAuthDpopProof = async (
  options: VerifyDpopProofOptions
): Promise<VerifiedDpopProof> => {
  const iatSkewSec = options.iatSkewSeconds ?? 60;
  try {
    return await verifyDpopProof({
      accessToken: options.accessToken,
      htm: options.htm,
      htu: options.htu,
      iatSkewSec,
      now: options.ports.clock.now(),
      proof: options.proof,
      replay: (jti) =>
        options.ports.oauthStateStore.recordDpopJti(
          jti,
          options.ports.clock.addSeconds(options.ports.clock.now(), iatSkewSec)
        ),
    });
  } catch (error) {
    if (error instanceof DpopVerifyError) {
      throw new OAuthDpopProofError(error.message);
    }
    throw error;
  }
};
