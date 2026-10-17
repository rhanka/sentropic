import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

/**
 * L1 seat-delivery authentication (conditional CISEAT-EX2). The delivery
 * principal is a dedicated control job reaching the application through the
 * restricted trusted hop only. Real mTLS termination lives at ingress (L3
 * P-DEPLOY owns the listener design). At the application layer this
 * middleware requires all three of:
 * - the trusted-hop marker (`SEAT_DELIVERY_TRUSTED_HOP=1`), set only on the
 *   restricted listener and never on public routes; absent means closed;
 * - a per-seat bearer token from the server-side seat registry
 *   (`SEAT_DELIVERY_SEATS_JSON`), compared in constant time; the registry
 *   also binds owner, account, scope, and billing receipt per seatRef;
 * - the admitted seatRef present in that registry.
 * Caller-supplied identity headers are never read: a plain forwarded header
 * is not authentication. Owner, account, scope, and billing always derive
 * from the registry entry; any disagreeing body value is refused downstream.
 */

export interface SeatDeliveryRegistryEntry {
  ownerUserId: string;
  externalAccountId: string;
  ownerScope: string;
  billingReceipt: string;
  token: string;
}

const isRegistryEntry = (value: unknown): value is SeatDeliveryRegistryEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['ownerUserId'] === 'string' && entry['ownerUserId'].length > 0 &&
    typeof entry['externalAccountId'] === 'string' && entry['externalAccountId'].length > 0 &&
    typeof entry['ownerScope'] === 'string' && entry['ownerScope'].length > 0 &&
    typeof entry['billingReceipt'] === 'string' && entry['billingReceipt'].length > 0 &&
    typeof entry['token'] === 'string' && entry['token'].length > 0
  );
};

/** Server-side seat registry: the only source of delivery identity. */
export const readSeatDeliveryRegistry = (): Record<string, SeatDeliveryRegistryEntry> => {
  try {
    const parsed: unknown = JSON.parse(process.env['SEAT_DELIVERY_SEATS_JSON'] ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const registry: Record<string, SeatDeliveryRegistryEntry> = {};
    for (const [seatRef, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRegistryEntry(entry)) registry[seatRef] = entry;
    }
    return registry;
  } catch {
    return {};
  }
};

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time bearer comparison over digests (length-safe). */
export const verifySeatDeliveryBearer = (presented: string | null, expected: string): boolean => {
  if (!presented || !expected) return false;
  const actual = digest(presented);
  const wanted = digest(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
};

/** Hono middleware enforcing the delivery contract above. */
export const requireSeatDeliveryAuth = async (context: Context, next: Next): Promise<Response | void> => {
  if (process.env['SEAT_DELIVERY_TRUSTED_HOP'] !== '1') {
    return context.json({ message: 'Seat delivery is closed on this listener' }, 503);
  }
  let seatRef = '';
  if (context.req.method !== 'GET') {
    try {
      const body = (await context.req.json()) as { seatRef?: unknown };
      seatRef = typeof body.seatRef === 'string' ? body.seatRef : '';
    } catch {
      return context.json({ message: 'Invalid delivery payload' }, 400);
    }
  } else {
    seatRef = context.req.query('seatRef') ?? '';
  }
  const entry = readSeatDeliveryRegistry()[seatRef];
  if (!seatRef || !entry) {
    return context.json({ message: 'Seat is not admitted for delivery' }, 403);
  }
  const presented = context.req.header('authorization');
  const bearer = presented?.startsWith('Bearer ') ? presented.slice('Bearer '.length) : null;
  if (!verifySeatDeliveryBearer(bearer, entry.token)) {
    return context.json({ message: 'Authentication required' }, 401);
  }
  context.set('seatRef', seatRef);
  context.set('seat', entry);
  await next();
};
