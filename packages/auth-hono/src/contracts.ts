import type { AuthHonoPorts } from './ports.js';

export const AUTH_HONO_AUTH_UI_METHODS = [
  'requestEmailCode',
  'verifyEmailCode',
  'verifyMagicLink',
  'createPasskeyRegistrationOptions',
  'verifyPasskeyRegistration',
  'createPasskeyAuthenticationOptions',
  'verifyPasskeyAuthentication',
  'refreshSession',
  'logout',
  'listCredentials',
  'renameCredential',
  'revokeCredential',
] as const;

export type AuthHonoAuthUiMethod = (typeof AUTH_HONO_AUTH_UI_METHODS)[number];

export type AuthHonoHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface AuthHonoRouteContract {
  method: AuthHonoHttpMethod;
  path: string;
}

export const AUTH_HONO_ROUTE_MAP = {
  requestEmailCode: {
    method: 'POST',
    path: '/email/verify-request',
  },
  verifyEmailCode: {
    method: 'POST',
    path: '/email/verify-code',
  },
  verifyMagicLink: {
    method: 'POST',
    path: '/magic-link/verify',
  },
  createPasskeyRegistrationOptions: {
    method: 'POST',
    path: '/register/options',
  },
  verifyPasskeyRegistration: {
    method: 'POST',
    path: '/register/verify',
  },
  createPasskeyAuthenticationOptions: {
    method: 'POST',
    path: '/login/options',
  },
  verifyPasskeyAuthentication: {
    method: 'POST',
    path: '/login/verify',
  },
  refreshSession: {
    method: 'POST',
    path: '/session/refresh',
  },
  logout: {
    method: 'DELETE',
    path: '/session',
  },
  listCredentials: {
    method: 'GET',
    path: '/credentials',
  },
  renameCredential: {
    method: 'PUT',
    path: '/credentials/:id',
  },
  revokeCredential: {
    method: 'DELETE',
    path: '/credentials/:id',
  },
} as const satisfies Record<AuthHonoAuthUiMethod, AuthHonoRouteContract>;

export const AUTH_HONO_REQUIRED_PORTS = [
  'users',
  'credentials',
  'challenges',
  'sessions',
  'emailVerification',
  'magicLinks',
  'emailDelivery',
  'cookies',
  'tokens',
  'auditLog',
  'clock',
  'random',
  'accountPolicy',
] as const satisfies readonly (keyof AuthHonoPorts)[];

export type AuthHonoRequiredPort = (typeof AUTH_HONO_REQUIRED_PORTS)[number];
