import { Hono, type Context } from 'hono';

import {
  AUTH_HONO_ROUTE_MAP,
  type AuthHonoAuthUiMethod,
  type AuthHonoRouteContract,
} from './contracts.js';
import type { AuthHonoPorts } from './ports.js';

export interface CreateAuthRouterOptions {
  cookieNames?: AuthHonoCookieNames;
  emailCode?: AuthHonoEmailCodePolicy;
  magicLink?: AuthHonoMagicLinkPolicy;
  ports?: AuthHonoPorts;
  responsePolicy?: AuthHonoResponsePolicy;
  routeOverrides?: Partial<Record<AuthHonoAuthUiMethod, AuthHonoRouteContract>>;
  routePrefix?: string;
  rp?: AuthHonoRelyingPartyOptions;
  session?: AuthHonoSessionPolicy;
  serviceName?: string;
}

export interface AuthHonoCookieNames {
  session: string;
  refresh: string;
}

export interface AuthHonoRelyingPartyOptions {
  id: string;
  name: string;
  expectedOrigins: string[];
}

export interface AuthHonoSessionPolicy {
  sessionTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface AuthHonoEmailCodePolicy {
  length: number;
  ttlSeconds: number;
  maxRequestsPerWindow: number;
  windowSeconds: number;
}

export interface AuthHonoMagicLinkPolicy {
  ttlSeconds: number;
  baseUrl?: string;
}

export interface AuthHonoResponsePolicy {
  notImplementedCode: string;
  notImplementedMessage: string;
}

export interface AuthHonoRouterConfig {
  cookieNames: AuthHonoCookieNames;
  emailCode: AuthHonoEmailCodePolicy;
  magicLink: AuthHonoMagicLinkPolicy;
  responsePolicy: AuthHonoResponsePolicy;
  routePrefix: string;
  routes: Record<AuthHonoAuthUiMethod, AuthHonoRouteContract>;
  rp?: AuthHonoRelyingPartyOptions;
  session: AuthHonoSessionPolicy;
  serviceName: string;
}

export type AuthHonoRouteHandler = (c: Context) => Response | Promise<Response>;

export type AuthHonoRouteHandlers = Partial<Record<AuthHonoAuthUiMethod, AuthHonoRouteHandler>>;

export const createAuthHonoConfig = (options: CreateAuthRouterOptions = {}): AuthHonoRouterConfig => ({
  cookieNames: {
    session: options.cookieNames?.session ?? 'session',
    refresh: options.cookieNames?.refresh ?? 'refreshToken',
  },
  emailCode: {
    length: options.emailCode?.length ?? 6,
    ttlSeconds: options.emailCode?.ttlSeconds ?? 10 * 60,
    maxRequestsPerWindow: options.emailCode?.maxRequestsPerWindow ?? 3,
    windowSeconds: options.emailCode?.windowSeconds ?? 10 * 60,
  },
  magicLink: {
    ttlSeconds: options.magicLink?.ttlSeconds ?? 10 * 60,
    baseUrl: options.magicLink?.baseUrl,
  },
  responsePolicy: {
    notImplementedCode: options.responsePolicy?.notImplementedCode ?? 'not_implemented',
    notImplementedMessage:
      options.responsePolicy?.notImplementedMessage ?? 'Auth route handler is not implemented yet.',
  },
  routePrefix: normalizeRoutePrefix(options.routePrefix),
  routes: {
    ...AUTH_HONO_ROUTE_MAP,
    ...options.routeOverrides,
  },
  rp: options.rp,
  session: {
    sessionTtlSeconds: options.session?.sessionTtlSeconds ?? 7 * 24 * 60 * 60,
    refreshTtlSeconds: options.session?.refreshTtlSeconds ?? 30 * 24 * 60 * 60,
  },
  serviceName: options.serviceName ?? 'auth',
});

export const createAuthRouter = (options: CreateAuthRouterOptions = {}): Hono => {
  const router = new Hono();
  const config = createAuthHonoConfig(options);

  router.get(joinRoutePath(config.routePrefix, '/health'), (c) =>
    c.json({ status: 'ok', service: config.serviceName })
  );

  for (const routeName of Object.keys(config.routes) as AuthHonoAuthUiMethod[]) {
    const contract = config.routes[routeName];

    router.on(contract.method, joinRoutePath(config.routePrefix, contract.path), (c) =>
      c.json(
        {
          error: {
            code: config.responsePolicy.notImplementedCode,
            message: config.responsePolicy.notImplementedMessage,
          },
        },
        501
      )
    );
  }

  return router;
};

const normalizeRoutePrefix = (prefix: string | undefined): string => {
  if (!prefix || prefix === '/') {
    return '';
  }

  return `/${prefix.replace(/^\/+|\/+$/g, '')}`;
};

const joinRoutePath = (prefix: string, path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${normalizedPath}`;
};
