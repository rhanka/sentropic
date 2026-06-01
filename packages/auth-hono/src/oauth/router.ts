import { Hono } from 'hono';

import { createOAuthAuthorizeHandler, type OAuthAuthorizeHandlerOptions } from './authorize-handler.js';
import {
  createOAuthConsentDecisionHandler,
  createOAuthConsentDetailsHandler,
} from './consent-decision-handler.js';
import { createOAuthTokenHandler } from './token-handler.js';

export interface CreateOAuthRouterOptions extends OAuthAuthorizeHandlerOptions {
  authorizationCodeTtlSeconds?: number;
  routePrefix?: string;
}

export const createOAuthRouter = (options: CreateOAuthRouterOptions): Hono => {
  const router = new Hono();
  const prefix = normalizeRoutePrefix(options.routePrefix ?? '/oauth');

  router.get(joinRoutePath(prefix, '/authorize'), createOAuthAuthorizeHandler(options));
  router.get(joinRoutePath(prefix, '/consent'), createOAuthConsentDetailsHandler(options));
  router.post(joinRoutePath(prefix, '/consent/decision'), createOAuthConsentDecisionHandler(options));
  router.post(joinRoutePath(prefix, '/token'), createOAuthTokenHandler(options));

  return router;
};

const normalizeRoutePrefix = (prefix: string): string => {
  if (!prefix || prefix === '/') return '';
  return `/${prefix.replace(/^\/+|\/+$/g, '')}`;
};

const joinRoutePath = (prefix: string, path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${normalizedPath}`;
};
