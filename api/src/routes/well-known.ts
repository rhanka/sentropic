import { createWellKnownRouter } from '@sentropic/auth-hono';
import { Hono, type Context } from 'hono';

import { getSentropicOAuthPorts, resolveOAuthIssuer } from './auth/oauth';

export const wellKnownRouter = new Hono();

wellKnownRouter.get('/openid-configuration', (c) =>
  forwardToWellKnownRouter(c, '/openid-configuration'),
);
wellKnownRouter.get('/jwks.json', (c) => forwardToWellKnownRouter(c, '/jwks.json'));

const forwardToWellKnownRouter = (c: Context, path: string): Response | Promise<Response> => {
  const url = new URL(c.req.url);
  url.pathname = path;
  url.search = '';

  const router = createWellKnownRouter({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: getSentropicOAuthPorts(),
  });

  return router.fetch(
    new Request(url, {
      headers: c.req.raw.headers,
      method: 'GET',
    }),
  );
};
