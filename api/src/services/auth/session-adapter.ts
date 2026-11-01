import type { AuthHonoCookiePort } from '@sentropic/auth-hono';
import { readDeviceCodeSnapshot } from '../device-code-store';
import { countCmSessions } from '../identity/cm-sessions';
import { findCmUserById } from '../identity/cm-users';

/**
 * Sentropic adapters for `@sentropic/auth-hono` session route handlers.
 *
 * Cookie serialization remains host configuration. Every identity operation
 * enters the CM session service through a fresh transaction binding.
 */

const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh_token';

const readCookie = (request: Request, name: string): string | null => {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? match[1] : null;
};

const maxAgeFrom = (expiresAt: Date): number =>
  Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

const serializeCookie = (name: string, value: string, maxAgeSeconds: number): string =>
  [
    `${name}=${value}`,
    'HttpOnly',
    isProduction ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');

export const authHonoCookiePort: AuthHonoCookiePort = {
  readRefreshToken: (request) => readCookie(request, REFRESH_COOKIE),
  readSessionToken: (request) => readCookie(request, SESSION_COOKIE),
  serializeClearedRefreshCookie: () => serializeCookie(REFRESH_COOKIE, '', 0),
  serializeClearedSessionCookie: () => serializeCookie(SESSION_COOKIE, '', 0),
  serializeRefreshCookie: ({ expiresAt, token }) =>
    serializeCookie(REFRESH_COOKIE, token, maxAgeFrom(expiresAt)),
  serializeSessionCookie: ({ expiresAt, token }) =>
    serializeCookie(SESSION_COOKIE, token, maxAgeFrom(expiresAt)),
};

export { cmAuthSessionService as authHonoSessionService } from '../identity/cm-session-facade';

export async function findSessionUser(userId: string) {
  const user = await findCmUserById(userId);
  if (!user) return null;
  return {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

export async function readSessionShadowSnapshot() {
  return {
    sessions: await countCmSessions(),
    devices: readDeviceCodeSnapshot(),
  };
}
