import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { RemoteAuthorityError } from './remote-contract';
import { logger } from '../../logger';

export function remoteRevocationError(error: Error, c: Context): Response {
  if (error instanceof RemoteAuthorityError && error.code === 'authority_unavailable') {
    c.header('Cache-Control', 'no-store');
    c.header('Retry-After', '60');
    c.header('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
    c.header('Set-Cookie', 'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', { append: true });
    return c.json({ error: 'authority_unavailable', revocation: 'pending' }, 503);
  }
  if (error instanceof HTTPException) return error.getResponse();
  logger.error({ err: error }, 'Request failed');
  return c.text('Internal Server Error', 500);
}
