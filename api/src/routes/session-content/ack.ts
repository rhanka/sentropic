import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import type { ReceiverRoute } from './route-table';
import { ReceiverRefusal, relayRefusal } from './errors';
import type { EventAckStore } from './ports';
import { readBody } from './body';
import type { GuardOk } from './guard';

const rawHash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

export const ACK_ROUTE_IDS = new Set(['activation-ack', 'continuity-ack', 'listing-grant-ack', 'drive-binding-ack', 'chat-events-ack']);

/** R-4: ACK routes commit first through the store; a failed commit never yields an ACK. */
export const ackHandler = (store: EventAckStore, route: ReceiverRoute) => async (c: Context, g: GuardOk) => {
  const body = await readBody(c, route);
  const requestDigest = rawHash(typeof body === 'string' ? body : JSON.stringify(body) ?? '');
  const circuitId = g.bound?.circuitId ?? 'outer';
  try {
    if (route.id === 'activation-ack' || route.id === 'continuity-ack') {
      const input = (body ?? {}) as Record<string, unknown>;
      if (route.id === 'activation-ack') {
        const ack = store.commitActivation({
          bindingId: String(g.params.bindingId), sourceSessionId: String(g.params.sourceSessionId),
          requestDigest, circuitId,
          operationId: String(input.operationId ?? ''), policyDigest: String(input.policyDigest ?? ''),
        });
        return c.json({ format: 'h2a.session-content-policy/1', kind: 'activation-ack',
          ackDigest: ack.ackDigest, authorityRevision: ack.authorityRevision, gaps: ack.gaps,
          circuitId, requestDigest }, route.successStatus as never);
      }
      const ack = store.commitEvents({
        bindingId: String(g.params.bindingId), sourceSessionId: String(g.params.sourceSessionId ?? ''),
        requestDigest, circuitId, streamId: String(input.streamId ?? ''),
        lastEventId: typeof input.lastEventId === 'string' ? input.lastEventId : null,
      });
      return c.json({ format: 'sentropic.remote-session/1', kind: 'event-ack',
        ackDigest: ack.ackDigest, admittedThrough: ack.admittedThrough, gaps: ack.gaps,
        circuitId, requestDigest }, route.successStatus as never);
    }
    const sessionRef = g.bound?.sessionRef ?? {
      originInstanceId: '', sessionId: String(g.params.sessionId ?? ''), incarnation: '',
    };
    const input = (body ?? {}) as Record<string, unknown>;
    const position = route.id === 'listing-grant-ack' ? 'listing-grant'
      : route.id === 'drive-binding-ack' ? 'drive-binding' : 'origin-writer';
    const ack = position === 'origin-writer'
      ? store.commitChat({ sessionRef, requestDigest, circuitId, contiguousThrough: Number(input.contiguousThrough ?? 0) })
      : store.commitProjection({ sessionRef, requestDigest, circuitId, position });
    return c.json({ format: 'cluster-mesh.session-relay/1', kind: 'projection-ack',
      ackDigest: ack.ackDigest, position, circuitId, requestDigest }, route.successStatus as never);
  } catch (error) {
    if (error instanceof ReceiverRefusal) throw error;
    throw relayRefusal('relay_scope_refused'); // uncommitted write: refusal, never a success-shaped ACK
  }
};
