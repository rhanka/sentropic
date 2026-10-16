import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createGatedTrustDomain,
  RFC8693_GRANT_TYPE,
  TokenExchangeRefusedError,
  type TokenExchangeRequest,
} from '../src/index.js';

describe('inter-server trust', () => {
  it('should expose an RFC 8693-shaped request contract without caller actor', () => {
    const request: TokenExchangeRequest = {
      grantType: RFC8693_GRANT_TYPE,
      subjectToken: 'opaque-subject-token',
      subjectTokenType: ACCESS_TOKEN_TYPE,
      requestedTokenType: ACCESS_TOKEN_TYPE,
      audience: 'https://remote.example.test',
      scope: ['workspace:read'],
    };

    expect(request.grantType).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect('actor' in request).toBe(false);
  });

  it('should keep refusal errors free of token material', () => {
    const error = new TokenExchangeRefusedError('scope_not_granted');

    expect(error).toMatchObject({ code: 'token_exchange_refused', reason: 'scope_not_granted' });
    expect(error.name).toBe('TokenExchangeRefusedError');
  });

  it('should fail closed for every exchange while the broker gate is closed', async () => {
    const trust = createGatedTrustDomain();
    const request: TokenExchangeRequest = {
      grantType: RFC8693_GRANT_TYPE,
      subjectToken: 'opaque-subject-token',
      subjectTokenType: ACCESS_TOKEN_TYPE,
      audience: 'https://remote.example.test',
      scope: [],
    };

    await expect(trust.tokenExchange.exchange(request)).rejects.toMatchObject({
      code: 'capability_gated',
      capability: 'rfc8693_token_exchange',
    });
  });
});
