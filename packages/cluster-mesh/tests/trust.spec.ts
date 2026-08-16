import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createGatedTrustDomain,
  RFC8693_GRANT_TYPE,
  type TokenExchangeRequest,
} from '../src/index.js';

describe('inter-server trust', () => {
  it('should expose an RFC 8693-shaped request contract', () => {
    const request: TokenExchangeRequest = {
      grantType: RFC8693_GRANT_TYPE,
      subjectToken: 'opaque-subject-token',
      subjectTokenType: ACCESS_TOKEN_TYPE,
      requestedTokenType: ACCESS_TOKEN_TYPE,
      audience: 'https://remote.example.test',
      scope: ['workspace:read'],
      actor: {
        sub: 'agent-1',
        iss: 'https://auth.example.test',
        h2aEngagement: 'engagement:opaque',
      },
    };

    expect(request.grantType).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(request.actor?.h2aEngagement).toBe('engagement:opaque');
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
