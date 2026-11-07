import type { LiveBinding, LivePorts } from './ports';
import { conflict, LiveError, liveRevision, type LiveKey, type LiveRuntime } from './records';
import { currentBinding } from './transitions';

/** The viewer authenticated by the host gate (A-LIVE §8.2). The host owns invitations (§9): it supplies one only after
 * its own check (named principal, this session and generation, current code rights, live consent). */
export interface LiveActor { principalId: string; invitation?: { id: string; epoch: number; expiresAt: number } }
export type LiveRole = 'binding_owner' | 'invitee';

/** Authority is the binding owner, i.e. the acting user, never a platform owner (plan Δ4). Writes: the binding owner
 * only. Reads: the binding owner, or an invitee holding an unexpired invitation issued at the current revocation epoch. */
export function liveRole(runtime: LiveRuntime, binding: LiveBinding, actor: LiveActor, access: 'read' | 'write',
  now: number, invitationEpoch: number): LiveRole {
  if (!actor.invitation && actor.principalId === binding.ownerId && actor.principalId === runtime.ownerId) return 'binding_owner';
  const invitation = actor.invitation;
  if (access === 'write' || !invitation || actor.principalId === runtime.ownerId || invitation.epoch < 1
    || invitation.epoch !== invitationEpoch || now >= invitation.expiresAt) throw new LiveError('access_denied');
  return 'invitee';
}

/** Route grant the host signs into its live assertion: the W9 claims without kid, host, iat and exp. `sourceRevision`
 * is an opaque string of at most LIVE_REVISION_MAX_LENGTH characters (the live-host assertion types it as a string). */
export async function authorizeLive(ports: LivePorts, key: LiveKey, actor: LiveActor, access: 'read' | 'write') {
  const binding = await currentBinding(ports, key);
  const runtime = (await ports.store.read(key))?.runtime;
  if (!runtime || runtime.generation !== binding.generation) conflict('stale_session');
  if (runtime.phase !== 'LIVE' || runtime.podUid === null || runtime.appliedRevision === null) conflict('invalid_phase');
  // The host fence is read on every grant, so a revocation refuses new grants before the next reconcile fences routes.
  const fence = await ports.invitations.current(key, runtime.generation);
  const role = liveRole(runtime, binding, actor, access, ports.now(), fence.epoch);
  const invitee = role === 'invitee' ? actor.invitation! : null;
  return { storageScopeId: key.storageScopeId, artifactId: key.artifactId, sessionId: runtime.sessionId,
    generation: runtime.generation, routeEpoch: runtime.routeEpoch, podUid: runtime.podUid, podName: runtime.podName,
    sourceRevision: liveRevision(runtime.appliedRevision), principalId: actor.principalId, role, invitationId: invitee?.id ?? '',
    invitationEpoch: invitee ? fence.epoch : 0, invitationExp: invitee ? Math.floor(invitee.expiresAt / 1000) : 0 };
}
