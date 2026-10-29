import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import { z } from 'zod';
import { parseRemoteJson, remoteId } from '../../services/auth/remote-contract';
import { createRemoteIdpRevocationPorts } from '../../services/auth/remote-revocation-idp';
import { boundedBody } from './remote-evidence';
import { authenticateRevocationBody, revocationMac, revocationServiceOrigin } from '../../services/auth/remote-revocation-transport';

const revocation = z.object({ sessionIds: z.array(remoteId).max(16), userId: remoteId.optional() }).strict()
  .refine(value => value.sessionIds.length > 0 || value.userId !== undefined);

export function createRemoteRevocationRouter() {
  const ports = createRemoteIdpRevocationPorts();
  type RevocationEnv = { Variables: { revocationClient: string } };
  const budget = rateLimiter<RevocationEnv>({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7',
    keyGenerator: c => c.get('revocationClient') });
  return new Hono<RevocationEnv>().post('/', async c => {
    c.header('Cache-Control', 'no-store');
    if (c.req.header('origin') || c.req.header('cookie')) return c.json({ error: 'origin_refused' }, 403);
    const url = new URL(c.req.url);
    // Public HTTP stays refused. Forwarded headers cannot opt callers into the service channel.
    if (url.protocol !== 'https:' && url.origin !== revocationServiceOrigin) return c.json({ error: 'authority_refused' }, 403);
    const client = await ports.authenticate(c.req.raw);
    if (!client) return c.json({ error: 'authentication_required' }, 401);
    let input, mac;
    try {
      const body = await boundedBody(c.req.raw);
      mac = authenticateRevocationBody(c.req.raw, body);
      if (!mac) return c.json({ error: 'authentication_required' }, 401);
      input = revocation.parse(parseRemoteJson(body));
    }
    catch { return c.json({ error: 'invalid_request' }, 400); }
    // Only the verified client can consume this budget; anonymous auth traffic cannot starve it.
    c.set('revocationClient', client);
    const limited = await budget(c, async () => {});
    if (limited) return limited;
    if (!ports.revoke(input)) return c.json({ error: 'authority_unavailable' }, 503);
    c.header('X-Revocation-Ack', revocationMac('ack', mac));
    return c.body(null, 204);
  });
}
