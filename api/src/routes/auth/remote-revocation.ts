import { Hono } from 'hono';
import { z } from 'zod';
import { parseRemoteJson, remoteId } from '../../services/auth/remote-contract';
import { createRemoteIdpRevocationPorts } from '../../services/auth/remote-revocation-idp';
import { boundedBody } from './remote-evidence';

const revocation = z.object({ sessionIds: z.array(remoteId).max(16), userId: remoteId.optional() }).strict()
  .refine(value => value.sessionIds.length > 0 || value.userId !== undefined);

export function createRemoteRevocationRouter() {
  const ports = createRemoteIdpRevocationPorts();
  return new Hono().post('/', async c => {
    c.header('Cache-Control', 'no-store');
    if (c.req.header('origin') || c.req.header('cookie')) return c.json({ error: 'origin_refused' }, 403);
    if (new URL(c.req.url).protocol !== 'https:') return c.json({ error: 'authority_refused' }, 403);
    if (!await ports.authenticate(c.req.raw)) return c.json({ error: 'authentication_required' }, 401);
    let input;
    try { input = revocation.parse(parseRemoteJson(await boundedBody(c.req.raw))); }
    catch { return c.json({ error: 'invalid_request' }, 400); }
    if (!ports.revoke(input)) return c.json({ error: 'authority_unavailable' }, 503);
    return c.body(null, 204);
  });
}
