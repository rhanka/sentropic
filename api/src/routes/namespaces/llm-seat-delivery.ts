import { Hono } from 'hono';

import {
  drainSeatDelivery,
  importSeatProjection,
  readSeatDeliveryTuple,
  reopenSeatDelivery,
  type SeatExternalPolicy,
} from '../../services/llm-account-transports';
import {
  requireSeatDeliveryAuth,
  type SeatDeliveryRegistryEntry,
  type SeatDeliveryTrust,
} from '../../middleware/llm-seat-delivery-auth';

/**
 * L1 seat-delivery receiver (conditional CISEAT-EX2). Imports custodian
 * projections monotonically, acknowledges the current tuple, and drains /
 * reopens seat admission around maintenance. Failed delivery leaves
 * admission closed; only a newer verified projection reopens use.
 *
 * Trust: owner, account, scope, and billing derive exclusively from the
 * server-side registry entry admitted by the middleware. Any body value
 * that disagrees is refused; the body only carries access material and
 * layer-mapping evidence.
 */

export interface SeatDeliveryProjectionBody {
  cli: 'agy' | 'claude' | 'codex' | 'muse' | 'vibe';
  ownerUserId?: string | null;
  expectedOwnerScope?: string | null;
  externalAccountId?: string | null;
  accountLabel?: string | null;
  accessToken: string;
  expiresAt?: string | null;
  seatPolicy: SeatExternalPolicy;
  billingClear?: boolean | null;
  packageProviderId?: string | null;
  packageAccountTransport?: string | null;
  requestedTargetProviderId?: string | null;
  requestedTransportProviderId?: string | null;
  issuingClientRef?: string | null;
  endpointFamily?: string | null;
  project?: string | null;
}

export const createSeatDeliveryRouter = (): Hono<{
  Variables: { seatRef: string; seat: SeatDeliveryRegistryEntry; deliveryTrust: SeatDeliveryTrust };
}> => {
  const router = new Hono<{
    Variables: { seatRef: string; seat: SeatDeliveryRegistryEntry; deliveryTrust: SeatDeliveryTrust };
  }>();
  router.use('/*', requireSeatDeliveryAuth);

  // The per-request trust attestation must be present: handlers never serve
  // a request the middleware did not authenticate, even if mounted directly.
  const requireDeliveryTrust = (context: {
    get(key: 'seatRef'): string;
    get(key: 'deliveryTrust'): SeatDeliveryTrust | undefined;
    json(message: unknown, status: number): Response;
  }): string | Response => {
    const seatRef = context.get('seatRef');
    const trust = context.get('deliveryTrust');
    if (!trust || trust.seatRef !== seatRef) {
      return context.json({ message: 'Seat delivery request was not authenticated' }, 503);
    }
    return seatRef;
  };

  router.post('/import', async (context) => {
    const body = (await context.req.json()) as SeatDeliveryProjectionBody;
    const trusted = requireDeliveryTrust(context);
    if (trusted instanceof Response) return trusted;
    const seatRef = trusted;
    const seat = context.get('seat');
    if (!body.seatPolicy || body.seatPolicy.seatRef !== seatRef) {
      return context.json({ message: 'Projection seatRef does not match the admitted seat' }, 409);
    }
    // Body identity must agree with the registry or be absent; the registry wins.
    const disagrees =
      (body.ownerUserId != null && body.ownerUserId !== seat.ownerUserId) ||
      (body.expectedOwnerScope != null && body.expectedOwnerScope !== seat.ownerScope) ||
      (body.externalAccountId != null && body.externalAccountId !== seat.externalAccountId) ||
      body.seatPolicy.ownerScope !== seat.ownerScope ||
      body.billingClear === false;
    if (disagrees) {
      return context.json({ message: 'Projection identity disagrees with the admitted seat' }, 409);
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
      // Same generation with a different operationId is a lineage conflict,
      // refused like the mesh (no silent upsert over a competing lineage).
      if (body.seatPolicy.generation === current.generation) {
        return context.json({ message: 'Same generation with a different operationId is a lineage conflict' }, 409);
      }
    }
    const stored = await importSeatProjection({
      cli: body.cli,
      ownerUserId: seat.ownerUserId,
      expectedOwnerScope: seat.ownerScope,
      externalAccountId: seat.externalAccountId,
      accountLabel: body.accountLabel,
      accessToken: body.accessToken,
      expiresAt: body.expiresAt,
      seatPolicy: body.seatPolicy,
      // Billing clearance derives from the registry receipt, never the body.
      billingClear: seat.billingReceipt.length > 0,
      packageProviderId: body.packageProviderId,
      packageAccountTransport: body.packageAccountTransport,
      requestedTargetProviderId: body.requestedTargetProviderId,
      requestedTransportProviderId: body.requestedTransportProviderId,
      issuingClientRef: body.issuingClientRef,
      endpointFamily: body.endpointFamily,
      project: body.project,
    });
    if (!stored) {
      return context.json({ message: 'Projection refused: billing, owner, mapping, or refresh check failed' }, 422);
    }
    return context.json({ acknowledged: true, idempotent: false, tuple: await readSeatDeliveryTuple(seatRef) });
  });

  router.get('/ack', async (context) => {
    const trusted = requireDeliveryTrust(context);
    if (trusted instanceof Response) return trusted;
    const tuple = await readSeatDeliveryTuple(trusted);
    if (!tuple) return context.json({ message: 'No delivered tuple for this seat' }, 404);
    return context.json({ acknowledged: true, tuple });
  });

  router.post('/drain', async (context) => {
    const trusted = requireDeliveryTrust(context);
    if (trusted instanceof Response) return trusted;
    await drainSeatDelivery(trusted);
    return context.json({ drained: true, seatRef: trusted });
  });

  router.post('/reopen', async (context) => {
    const trusted = requireDeliveryTrust(context);
    if (trusted instanceof Response) return trusted;
    const tuple = await reopenSeatDelivery(trusted);
    if (!tuple) return context.json({ message: 'No delivered tuple for this seat' }, 404);
    return context.json({ reopened: true, tuple });
  });

  return router;
};
