import type { LivePorts } from './ports';
import { conflict, type LiveKey } from './records';
import { podName } from './pods';

/** Fences of one package LiveService session (the host's `record.runtime`), echoed in every BridgeAck. */
export interface PackageFences { liveSessionId: string; leaseEpoch: number; routeEpoch: number }
export interface RemoteSession extends PackageFences { generation: number; ownerId: string }
/** The session invitation state the host owns (§9): its revocation epoch and the latest expiry among the active
 * invitations (null when none is active). The epoch is shared by every reader of the session. */
export interface SessionInvitation { epoch: number; expiresAt: number | null }
/** Host KV rows of the remote live state; `update` is one serialized read-modify-write of one row (a throw aborts it). */
export interface RemoteRows {
  read<T>(key: string): Promise<T | undefined>;
  update<T, R>(key: string, change: (current: T | undefined) => { next?: T; result: R }): Promise<R>;
}
/** Rows are named by the immutable pod name of the binding (a digest of scope and artifact), which the runtime carries. */
export const rowOf = (binding: string, ...rest: Array<string | number>) => JSON.stringify([binding, ...rest]);
const stale = (): never => conflict('stale_session');
const fencesOf = (s: RemoteSession): PackageFences => ({ liveSessionId: s.liveSessionId, leaseEpoch: s.leaseEpoch, routeEpoch: s.routeEpoch });

/**
 * A-LIVE remote host (D0): the host runs the package LiveService and owns the invitations (§9). Per binding the builder
 * keeps the package fences of the newest reconcile, and per binding generation the last session invitation state the
 * host pushed with a reconcile or a grant.
 */
export function createRemoteLive(rows: RemoteRows) {
  const fenceRow = (key: LiveKey) => rowOf(podName(key), 'fences');
  const invitationRow = (key: LiveKey, generation: number) => rowOf(podName(key), 'invitation', generation);
  const read = (key: LiveKey) => rows.read<RemoteSession>(fenceRow(key));
  return {
    invitations: {
      current: async (key, generation) => (await rows.read<SessionInvitation>(invitationRow(key, generation)))
        ?? { epoch: 0, expiresAt: null },
    } satisfies LivePorts['invitations'],
    /** Records the session invitation state of this generation as last received; a lower epoch is stale. */
    invitation: (key: LiveKey, generation: number, next: SessionInvitation) =>
      rows.update<SessionInvitation, void>(invitationRow(key, generation), current => {
        if (current && next.epoch < current.epoch) conflict('stale_invitation');
        return { next: { epoch: next.epoch, expiresAt: next.expiresAt }, result: undefined };
      }),
    /** Records the package fences of a reconcile, monotonic per generation; an older or reordered call is stale. */
    reconciled: (key: LiveKey, next: RemoteSession) => rows.update<RemoteSession, PackageFences>(fenceRow(key), s => {
      if (s && (next.generation < s.generation || (next.generation === s.generation && (next.ownerId !== s.ownerId
        || next.leaseEpoch < s.leaseEpoch || (next.leaseEpoch === s.leaseEpoch
          && (next.liveSessionId !== s.liveSessionId || next.routeEpoch < s.routeEpoch)))))) stale();
      return { next: { ...next }, result: fencesOf(next) };
    }),
    /** `packageRuntime` of the bridge: the fences of the newest reconcile of this generation. */
    async fences(key: LiveKey, generation: number) {
      const s = await read(key);
      return s && s.generation === generation ? fencesOf(s) : stale();
    },
    /** Binding generation and owner the host reconciled last; a binding never reconciled is stale. */
    session: async (key: LiveKey) => (await read(key)) ?? stale(),
  };
}
export type RemoteLive = ReturnType<typeof createRemoteLive>;
