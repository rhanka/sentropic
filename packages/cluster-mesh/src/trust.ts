import { CapabilityGatedError } from './errors.js';

export const RFC8693_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange' as const;
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token' as const;

/** RFC 8693 exchange request. The caller never supplies an actor: `act` is
 * minted by the issuer from the configured workload identity (spec-v3 §6). */
export interface TokenExchangeRequest {
  readonly grantType: typeof RFC8693_GRANT_TYPE;
  readonly subjectToken: string;
  readonly subjectTokenType: string;
  readonly requestedTokenType?: string;
  readonly audience: string;
  readonly scope: readonly string[];
}

export interface TokenExchangeResponse {
  readonly accessToken: string;
  readonly issuedTokenType: string;
  readonly tokenType: 'Bearer' | 'DPoP';
  readonly expiresIn: number;
  readonly scope: readonly string[];
}

/** RFC 8693 broker seam. A future binding owns issuer trust, membership and DPoP policy. */
export interface TokenExchangePort {
  exchange(request: TokenExchangeRequest): Promise<TokenExchangeResponse>;
}

export interface TrustDomain {
  readonly tokenExchange: TokenExchangePort;
}

export function createGatedTrustDomain(): TrustDomain {
  return {
    tokenExchange: {
      async exchange() {
        throw new CapabilityGatedError('rfc8693_token_exchange');
      },
    },
  };
}
