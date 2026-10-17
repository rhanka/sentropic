import { Hono } from 'hono';

import {
  drainSeatDelivery,
  importSeatProjection,
  readSeatDeliveryTuple,
  reopenSeatDelivery,
  type SeatExternalPolicy,
} from '../../services/llm-account-transports';
import { requireSeatDeliveryAuth } from '../../middleware/llm-seat-delivery-auth';

/**
 * L1 seat-delivery receiver (conditional CISEAT-EX2). Imports custodian
 * projections monotonically, acknowledges the current tuple, and drains /
 * reopens seat admission around maintenance. Failed delivery leaves
 * admission closed; only a newer verified projection reopens use.
 */

export interface SeatDeliveryProjectionBody {
  cli: 'agy' | 'claude';
  ownerUserId: string;
  expectedOwnerScope: string;
  externalAccountId: string;
  accountLabel?: string | null;
  accessToken: string;
  expiresAt?: string | null;
  seatPolicy: SeatExternalPolicy;
  billingClear: boolean;
  packageProviderId?: string | null;
  packageAccountTransport?: string | null;
  requestedTargetProviderId?: string | null;
  requestedTransportProviderId?: string | null;
  issuingClientRef?: string | null;
  endpointFamily?: string | null;
  project?: string | null;
}

export const createSeatDeliveryRouter = (): Hono<{ Variables: { seatRef: string } }> => {
  const router = new Hono<{ Variables: { seatRef: string } }>();
  router.use('/*', requireSeatDeliveryAuth);

  router.post('/import', async (context) => {
    const body = (await context.req.json()) as SeatDeliveryProjectionBody;
    const seatRef = context.get('seatRef') as string;
    if (!body.seatPolicy || body.seatPolicy.seatRef !== seatRef) {
      return context.json({ message: 'Projection seatRef does not match the admitted seat' }, 409);
    }
    const current = await readSeatDeliveryTuple(seatRef);
    if (current) {
      if (body.seatPolicy.epoch !== current.epoch) {
        return context.json({ message: 'A new epoch requires the controlled replacement operation' }, 409);
      }
      if (body.seatPolicy.generation < current.generation) {
        return context.json({ message: 'Incoming generation is older than current' }, 409);
      }
      if (
        body.seatPolicy.generation === current.generation &&
        body.seatPolicy.operationId === current.operationId
      ) {
        return context.json({ acknowledged: true, idempotent: true, tuple: current });
      }
    }
    const stored = await importSeatProjection(body);
    if (!stored) {
      return context.json({ message: 'Projection refused: billing, owner, mapping, or refresh check failed' }, 422);
    }
    return context.json({ acknowledged: true, idempotent: false, tuple: await readSeatDeliveryTuple(seatRef) });
  });

  router.get('/ack', async (context) => {
    const seatRef = context.get('seatRef') as string;
    const tuple = await readSeatDeliveryTuple(seatRef);
    if (!tuple) return context.json({ message: 'No delivered tuple for this seat' }, 404);
    return context.json({ acknowledged: true, tuple });
  });

  router.post('/drain', async (context) => {
    const seatRef = context.get('seatRef') as string;
    await drainSeatDelivery(seatRef);
    return context.json({ drained: true, seatRef });
  });

  router.post('/reopen', async (context) => {
    const seatRef = context.get('seatRef') as string;
    const tuple = await reopenSeatDelivery(seatRef);
    if (!tuple) return context.json({ message: 'No delivered tuple for this seat' }, 404);
    return context.json({ reopened: true, tuple });
  });

  return router;
};
