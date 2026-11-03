import type { Context } from 'hono';
import type { ReceiverRoute } from './route-table';
import { entityRefusal, oversizeRefusal } from './errors';

/** Bounded annex-D body read — only after the guard and the media check passed. */
export const readBody = async (c: Context, route: ReceiverRoute): Promise<unknown> => {
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  // r3 N2: bodyless routes (maxRequestBytes 0) carry zero entity bytes; any actual entity
  // byte refuses with the route family's annex-D code, even when undeclared at the header level.
  if (route.maxRequestBytes === 0) {
    if (bytes.byteLength > 0) throw entityRefusal(route);
    return null;
  }
  if (bytes.byteLength > route.maxRequestBytes) throw oversizeRefusal(route);
  if (bytes.byteLength === 0) return null;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    throw entityRefusal(route);
  }
};
