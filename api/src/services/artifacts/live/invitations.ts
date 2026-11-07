import type { LivePorts } from './ports';
import { conflict, type LiveKey } from './records';
import { failed, transition } from './transitions';

/**
 * Invitee reads end on revocation, expiry, stop or a new generation (stop and generation changes already tear the route
 * down). On a revocation epoch change or an expired invitation the route epoch advances: the edge rejects every
 * assertion minted for an older epoch and closes its sockets; the binding owner reconnects on the new epoch.
 */
/** Returns false when the session no longer is LIVE (fail-closed teardown ran). */
export async function fenceInvitations(ports: LivePorts, key: LiveKey): Promise<boolean> {
  const state = await ports.store.read(key);
  if (!state || state.runtime.phase !== 'LIVE') return false;
  const { runtime } = state;
  const expired = runtime.invitationExpiresAt !== null && ports.now() >= runtime.invitationExpiresAt;
  const current = await ports.invitations.current(key, runtime.generation);
  if (current.epoch === runtime.invitationEpoch && !expired) return true;
  const fenced = await transition(ports, key, runtime, next => {
    if (next.runtime.phase !== 'LIVE') conflict('transition_busy');
    next.runtime.routeEpoch++; next.runtime.invitationEpoch = current.epoch;
    next.runtime.invitationExpiresAt = current.expiresAt;
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
