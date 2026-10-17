import type { Context, Next } from 'hono';

/**
 * L1 seat-delivery authentication (conditional CISEAT-EX2). The delivery
 * principal is a dedicated control job reaching the application through the
 * restricted trusted hop only. Real mTLS termination lives at ingress (see
 * deploy/k8s manifests; proven in L3 P-DEPLOY). At the application layer this
 * middleware requires all three of:
 * - the trusted-hop marker (`SEAT_DELIVERY_TRUSTED_HOP=1`), set only on the
 *   restricted listener and never on public routes;
 * - the delivery bearer token (`SEAT_DELIVERY_TOKEN`), held only by
 *   delivery-control jobs, never by native/consumer jobs;
 * - a body seatRef inside the fixed allowlist (`SEAT_DELIVERY_ALLOWLIST`).
 * A plain forwarded header alone is never authentication.
 */

export const verifySeatDeliveryRequest = (request: Request): { ok: true; seatRef: string } | { ok: false; status: number; message: string } => {
  if (process.env['SEAT_DELIVERY_TRUSTED_HOP'] !== '1') {
    return { ok: false, status: 503, message: 'Seat delivery is closed on this listener' };
  }
  const expected = process.env['SEAT_DELIVERY_TOKEN'];
  if (!expected) {
    return { ok: false, status: 503, message: 'Seat delivery is not configured' };
  }
  const presented = request.headers.get('authorization');
  if (presented !== `Bearer ${expected}`) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }
  return { ok: true, seatRef: '' };
};

export const seatDeliveryAllowlist = (): string[] =>
  (process.env['SEAT_DELIVERY_ALLOWLIST'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/** Hono middleware enforcing the delivery contract above. */
export const requireSeatDeliveryAuth = async (context: Context, next: Next): Promise<Response | void> => {
  const verified = verifySeatDeliveryRequest(context.req.raw);
  if (!verified.ok) {
    return context.json({ message: verified.message }, verified.status as 401 | 503);
  }
  const allowlist = seatDeliveryAllowlist();
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
  if (!seatRef || !allowlist.includes(seatRef)) {
    return context.json({ message: 'Seat is not admitted for delivery' }, 403);
  }
  context.set('seatRef', seatRef);
  await next();
};
