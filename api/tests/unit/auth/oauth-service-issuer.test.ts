import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../../src/config/env';
import { resolveOAuthIssuer, resolveOAuthServiceIssuer } from '../../../src/routes/auth/oauth';

/**
 * Preprod S2S issuer regression: the standalone IdP (preprod.auth.sent-tech.ca) mints the
 * client_credentials tokens of tenant hosts, while the api serves preprod.sentropic.sent-tech.ca.
 * The github-app broker and artifact builder guards must expect the IdP issuer without moving the
 * api's own issuer (OAUTH_ISSUER_URL also drives its AS metadata and federation redirect_uri).
 */
describe('resolveOAuthServiceIssuer', () => {
  const originalServiceIssuer = env.OAUTH_SERVICE_ISSUER_URL;
  const originalIssuer = env.OAUTH_ISSUER_URL;
  const request = new Request('https://preprod.sentropic.sent-tech.ca/api/v1/github-app/broker/lease', {
    headers: { 'x-forwarded-host': 'preprod.sentropic.sent-tech.ca', 'x-forwarded-proto': 'https' },
  });

  afterEach(() => {
    env.OAUTH_SERVICE_ISSUER_URL = originalServiceIssuer;
    env.OAUTH_ISSUER_URL = originalIssuer;
  });

  it('should expect the configured IdP issuer and leave the api issuer on the request origin', () => {
    env.OAUTH_ISSUER_URL = undefined;
    env.OAUTH_SERVICE_ISSUER_URL = 'https://preprod.auth.sent-tech.ca/';
    expect(resolveOAuthServiceIssuer(request)).toBe('https://preprod.auth.sent-tech.ca');
    expect(resolveOAuthIssuer(request)).toBe('https://preprod.sentropic.sent-tech.ca');
  });

  it('should fall back to the api issuer when no service issuer is configured', () => {
    env.OAUTH_ISSUER_URL = undefined;
    env.OAUTH_SERVICE_ISSUER_URL = undefined;
    expect(resolveOAuthServiceIssuer(request)).toBe(resolveOAuthIssuer(request));
    expect(resolveOAuthServiceIssuer(request)).toBe('https://preprod.sentropic.sent-tech.ca');
  });
});
