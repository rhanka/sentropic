import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../../src/config/env';
import {
  resolveOAuthIssuer,
  resolveOAuthServiceIssuer,
  resolveOAuthServiceResource,
} from '../../../src/routes/auth/oauth';

/**
 * Preprod S2S regression: the standalone IdP (preprod.auth.sent-tech.ca) mints the
 * client_credentials tokens of tenant hosts (`aud` = the https product host), while the api sits
 * behind the plain-HTTP ui nginx, which forwards `X-Forwarded-Proto: http`. The github-app broker and
 * artifact builder guards must expect the declared IdP issuer and https resource, without moving
 * the api's own issuer (OAUTH_ISSUER_URL also drives its AS metadata and federation redirect_uri).
 */
describe('S2S service issuer and resource', () => {
  const original = {
    issuer: env.OAUTH_ISSUER_URL,
    resource: env.OAUTH_SERVICE_RESOURCE_URI,
    serviceIssuer: env.OAUTH_SERVICE_ISSUER_URL,
  };
  // The header shape of the real hop: Traefik (TLS) -> ui nginx :5173 (plain HTTP) -> api.
  const nginxHop = new Request('http://preprod.sentropic.sent-tech.ca/api/v1/github-app/broker/lease', {
    headers: { 'x-forwarded-host': 'preprod.sentropic.sent-tech.ca', 'x-forwarded-proto': 'http' },
  });

  afterEach(() => {
    env.OAUTH_ISSUER_URL = original.issuer;
    env.OAUTH_SERVICE_RESOURCE_URI = original.resource;
    env.OAUTH_SERVICE_ISSUER_URL = original.serviceIssuer;
  });

  it('should expect the declared IdP issuer and https resource when both are configured', () => {
    env.OAUTH_ISSUER_URL = undefined;
    env.OAUTH_SERVICE_ISSUER_URL = 'https://preprod.auth.sent-tech.ca/';
    env.OAUTH_SERVICE_RESOURCE_URI = 'https://preprod.sentropic.sent-tech.ca';
    expect(resolveOAuthServiceIssuer(nginxHop)).toBe('https://preprod.auth.sent-tech.ca');
    expect(resolveOAuthServiceResource(nginxHop)).toBe('https://preprod.sentropic.sent-tech.ca');
    expect(resolveOAuthIssuer(nginxHop)).toBe('http://preprod.sentropic.sent-tech.ca');
  });

  it('should fall back to the request-derived api issuer when nothing is configured', () => {
    env.OAUTH_ISSUER_URL = undefined;
    env.OAUTH_SERVICE_ISSUER_URL = undefined;
    env.OAUTH_SERVICE_RESOURCE_URI = undefined;
    expect(resolveOAuthServiceIssuer(nginxHop)).toBe('http://preprod.sentropic.sent-tech.ca');
    expect(resolveOAuthServiceResource(nginxHop)).toBe('http://preprod.sentropic.sent-tech.ca');
  });
});
