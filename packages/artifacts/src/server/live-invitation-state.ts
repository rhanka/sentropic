import type { LiveInvitationState, LiveServiceDeps, LiveSessionService, LiveViewer } from './live-contracts.js';
import type { LiveDraftRecord, LiveIdentity, LiveInvitationRecord, LiveTransaction } from './live-store.js';

export const isOpenInvitation = (row: LiveInvitationRecord) => row.status === 'pending' || row.status === 'active';
/** The session an invitation binds: the binding generation's current runtime, never a stopped (DORMANT) one. */
export const currentLiveSession = (record: LiveDraftRecord | undefined) =>
  record?.runtime && record.runtime.phase !== 'DORMANT' ? record.runtime.liveSessionId : null;

/** Projects ceased (other session or generation) and expired invitations; writers persist the transitions. */
export async function sweepInvitations(tx: LiveTransaction, identity: LiveIdentity, now: number, persist: boolean) {
  const rows = (await tx.invitations!.list()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) ||
    a.invitationId.localeCompare(b.invitationId));
  for (const row of rows) {
    if (!isOpenInvitation(row)) continue;
    const status = row.bindingGeneration !== identity.bindingGeneration || row.liveSessionId !== currentLiveSession(tx.record)
      ? 'ceased' : Date.parse(row.expiresAt) <= now ? 'expired' : row.status;
    if (status === row.status) continue;
    Object.assign(row, { status, rowVersion: row.rowVersion + 1 });
    if (persist) await tx.invitations!.save(row);
  }
  return rows;
}

/** `liveInvitationState` and `liveViewer` read the committed state; they never write. */
export function liveInvitationViews(deps: LiveServiceDeps): Omit<LiveSessionService, 'execute' | 'redrive'> {
  const qualified = () => deps.invitations?.qualified === true;
  const read = <T>(identity: LiveIdentity, empty: T, action: (rows: LiveInvitationRecord[], session: string,
    tx: LiveTransaction) => Promise<T>) => deps.store.transaction(identity, async tx => {
    const session = currentLiveSession(tx.record);
    if (!session) return empty;
    return action(qualified() && tx.invitations ? await sweepInvitations(tx, identity, (deps.now ?? Date.now)(), false) : [], session, tx);
  });
  return {
    liveInvitationState: identity => read<LiveInvitationState>(identity, { epoch: 0, expiresAt: null }, async (rows, session, tx) => {
      const active = rows.filter(row => row.liveSessionId === session && row.status === 'active').map(row => Date.parse(row.expiresAt));
      return { epoch: qualified() && tx.invitations ? await tx.invitations.epoch(identity.bindingGeneration, session) : 0,
        expiresAt: active.length ? Math.max(...active) : null };
    }),
    liveViewer: (identity, principalId) => read<LiveViewer>(identity, null, async (rows, session, tx) => {
      if (principalId === tx.record!.runtime!.ownerId) return { role: 'binding_owner' as const };
      const row = rows.find(entry => entry.liveSessionId === session && entry.principalId === principalId && entry.status === 'active');
      return row ? { role: 'invitee' as const, invitation: { id: row.invitationId, epoch: row.epoch,
        expiresAt: Date.parse(row.expiresAt) } } : null;
    }),
  };
}
