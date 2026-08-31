import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { oauthRouter } from '../../src/routes/auth/oauth';
import {
  createSentropicOAuthIngress,
  createSentropicWellKnownIngress,
} from '../../src/routes/namespaces/oauth-ingress';
import { wellKnownRouter } from '../../src/routes/well-known';

const LEGACY_OAUTH_PATH = '/api/v1/auth/oauth';

describe('cluster mesh OAuth pre-cutover shadow', () => {
  it('matches deterministic protocol responses without executing token effects twice', async () => {
    const legacy = new Hono().route(LEGACY_OAUTH_PATH, oauthRouter);
    const candidate = new Hono().route(
      LEGACY_OAUTH_PATH,
      createSentropicOAuthIngress(LEGACY_OAUTH_PATH),
    );
    const request = (app: Hono) => app.request(`http://localhost:9197${LEGACY_OAUTH_PATH}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=unsupported',
    });

    const legacyResponse = await request(legacy);
    const candidateResponse = await request(candidate);
    expect(candidateResponse.status).toBe(legacyResponse.status);
    expect(await candidateResponse.json()).toEqual(await legacyResponse.json());
  });

  it('matches discovery metadata and logout projection before legacy deletion', async () => {
    const legacy = new Hono()
      .route('/.well-known', wellKnownRouter)
      .route(LEGACY_OAUTH_PATH, oauthRouter);
    const candidate = new Hono()
      .route('/.well-known', createSentropicWellKnownIngress(LEGACY_OAUTH_PATH))
      .route(LEGACY_OAUTH_PATH, createSentropicOAuthIngress(LEGACY_OAUTH_PATH));

    for (const path of ['/.well-known/openid-configuration', `${LEGACY_OAUTH_PATH}/end_session`]) {
      const legacyResponse = await legacy.request(`http://localhost:9197${path}`, {
        headers: { 'sec-fetch-mode': 'navigate' },
      });
      const candidateResponse = await candidate.request(`http://localhost:9197${path}`, {
        headers: { 'sec-fetch-mode': 'navigate' },
      });
      expect(candidateResponse.status).toBe(legacyResponse.status);
      expect(await candidateResponse.text()).toBe(await legacyResponse.text());
    }
  });
});
