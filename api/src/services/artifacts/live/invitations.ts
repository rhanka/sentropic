import type { LivePorts } from './ports';
import { conflict, type LiveKey } from './records';
import { failed, transition } from './transitions';

/**
 * Invitee reads end on revocation, expiry, stop or a new generation (stop and generation changes already tear the route
 * down). The host expiry is the latest among the active invitations, so the route epoch advances on a revocation epoch
 * change or once the last invitation expired: the edge rejects every assertion minted for an older epoch and closes its
 * sockets; everyone, the binding owner included, reconnects on the new epoch. An earlier invitee expiry is the edge's
 * (the assertion `invitationExp`). A later expiry at the same epoch is adopted without fencing; a pending expiry fence is
 * never cancelled at the same epoch.
 */
/** Returns false when the session no longer is LIVE (fail-closed teardown ran). */
export async function fenceInvitations(ports: LivePorts, key: LiveKey): Promise<boolean> {
  const state = await ports.store.read(key);
  if (!state || state.runtime.phase !== 'LIVE') return false;
  const { runtime } = state; const now = ports.now();
  const current = await ports.invitations.current(key, runtime.generation);
  const upcoming = current.expiresAt !== null && now < current.expiresAt ? current.expiresAt : null;
  const lapsed = upcoming === null && runtime.invitationExpiresAt !== null && now >= runtime.invitationExpiresAt;
  if (current.epoch === runtime.invitationEpoch && !lapsed) {
    if (upcoming !== null && upcoming !== runtime.invitationExpiresAt) {
      await transition(ports, key, runtime, next => { next.runtime.invitationExpiresAt = upcoming; });
    }
    return true;
  }
  const fenced = await transition(ports, key, runtime, next => {
    if (next.runtime.phase !== 'LIVE') conflict('transition_busy');
    next.runtime.routeEpoch++; next.runtime.invitationEpoch = current.epoch;
    next.runtime.invitationExpiresAt = upcoming;
  });
  try {
    await ports.routes.revoke(key, fenced);
    // The supervisor must adopt the new route epoch before the route reopens; a stale one stays closed.
    const live = await ports.worker.live(fenced);
    if (live.routeEpoch !== fenced.routeEpoch || live.revision !== fenced.appliedRevision) conflict('stale_fence');
    await ports.routes.ready(key, fenced);
  } catch (error) { await failed(ports, key, fenced, error); return false; }
  return true;
}
