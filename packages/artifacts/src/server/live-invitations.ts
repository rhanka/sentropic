import { randomUUID } from 'node:crypto';
import { orderedDigest } from '../profile/json.js';
import { ArtifactOperationError } from './failures.js';
import { liveBusy } from './live-mutations.js';
import { UNKNOWN_USER_REF } from './ports.js';
import { currentLiveSession as currentSession, isOpenInvitation as open, sweepInvitations as sweep } from './live-invitation-state.js';
import type { LiveAuthority, LiveInvitationRevoked, LiveInvocation, LiveServiceDeps } from './live-contracts.js';
import type { LiveInvitationRecord, LiveResult } from './live-store.js';

/** Generic live invitations (A-LIVE v2 §8.2, §9; contract 2026-11-07). Viewing only: no edit, publication or release grant. */
export const LIVE_INVITATION_OPERATIONS = ['live_invite', 'live_accept_invitation', 'live_revoke_invitation', 'live_invitations'] as const;
export const LIVE_INVITATIONS_OPEN_MAX = 16;
const PAGE = 50;
const denied = () => new ArtifactOperationError('access_denied');
const iso = (ms: number) => new Date(ms).toISOString();
function admit(authority: LiveAuthority, invocation: LiveInvocation, artifactId: string): void {
  const { binding, target } = authority;
  if (target.storageScopeId !== binding.storageScopeId || target.repoId !== binding.repoId || target.branch !== binding.branch ||
    target.subPath !== binding.subPath || target.principalId !== invocation.actorId ||
    binding.storageScopeId !== invocation.storageScopeId || binding.artifactId !== artifactId) throw denied();
}
const terminal = (row: LiveInvitationRecord): never => {
  if (row.status === 'ceased') liveBusy('stale_session');
  throw new ArtifactOperationError(row.status === 'expired' ? 'gone' : 'access_denied');
};
/** The onRevoked event of a revoked row; its epoch is frozen once the row leaves the open set. */
const revokedEvent = (row: LiveInvitationRecord): LiveInvitationRevoked => ({ storageScopeId: row.storageScopeId,
  artifactId: row.artifactId, liveSessionId: row.liveSessionId, bindingGeneration: row.bindingGeneration,
  invitationId: row.invitationId, epoch: row.epoch });
const cursorOf = (session: string, offset: number) => Buffer.from(JSON.stringify([session, offset])).toString('base64url');
function offsetOf(cursor: unknown, session: string | null): number {
  if (cursor === undefined) return 0;
  try {
    const [owner, offset] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (owner === session && Number.isSafeInteger(offset) && offset > 0) return offset;
  } catch { /* closed refusal below */ }
  throw new ArtifactOperationError('invalid_request');
}

export async function executeLiveInvitation(deps: LiveServiceDeps, operation: string, args: Record<string, any>,
  invocation: LiveInvocation): Promise<Record<string, any>> {
  const port = deps.invitations;
  if (port?.qualified !== true) throw new ArtifactOperationError('builder_unavailable');
  const now = (deps.now ?? Date.now)();
  const writer = operation !== 'live_invitations';
  if (writer && (!args.idempotencyKey.trim() || args.idempotencyKey.length > (deps.idempotencyKeyMaxUnits ?? 256))) {
    throw new ArtifactOperationError('invalid_request');
  }
  const authority = await deps.authorize(invocation, args.artifactId);
  admit(authority, invocation, args.artifactId);
  const owner = authority.ownerId === invocation.actorId;
  const identity = { storageScopeId: invocation.storageScopeId, artifactId: authority.binding.artifactId,
    bindingGeneration: authority.binding.generation };
  let principalId: string | undefined;
  if (operation === 'live_invite') {
    if (!owner || !authority.canReadCode || !authority.canWrite || !authority.humanLinked) throw denied();
    if (!authority.qualified) throw new ArtifactOperationError('builder_unavailable');
    principalId = await port.resolvePrincipal(invocation.storageScopeId, args.userRef);
    if (!principalId) throw denied();
    if (principalId === authority.ownerId) throw new ArtifactOperationError('invalid_request');
    const invitee = await deps.authorize({ ...invocation, actorId: principalId }, args.artifactId);
    if (!invitee.canReadCode || !invitee.humanLinked || invitee.binding.generation !== identity.bindingGeneration) throw denied();
  }
  if (operation === 'live_accept_invitation' && (!authority.canReadCode || !authority.humanLinked)) throw denied();
  const command = writer ? { actorId: invocation.actorId, key: args.idempotencyKey as string,
    hash: orderedDigest({ operation, args }), operation } : undefined;
  let revoked: LiveInvitationRevoked | undefined;
  const result = await deps.store.transaction(identity, async tx => {
    const ledger = tx.invitations;
    if (!ledger) throw new ArtifactOperationError('capability_unselected');
    if (command) {
      const prior = await tx.receipt(command.actorId, command.key);
      if (prior && prior.hash !== command.hash) throw new ArtifactOperationError('command_conflict');
      if (prior) {
        // A replayed revoke re-invokes the idempotent onRevoked: the first push may have failed after the commit.
        if (operation === 'live_revoke_invitation' && prior.result.status === 'revoked') {
          const row = (await ledger.list()).find(entry => entry.invitationId === args.invitationId && entry.status === 'revoked');
          if (row) revoked = revokedEvent(row);
        }
        return { ...prior.result, replayed: true };
      }
    }
    const rows = await sweep(tx, identity, now, writer);
    const session = currentSession(tx.record);
    let out: Record<string, any>;
    if (operation === 'live_invite') {
      if (!session || args.liveSessionId !== session) liveBusy('stale_session');
      const opened = rows.filter(row => open(row) && row.liveSessionId === session);
      if (opened.some(row => row.principalId === principalId)) liveBusy('active_session');
      if (opened.length >= LIVE_INVITATIONS_OPEN_MAX) throw new ArtifactOperationError('limit_exceeded');
      let epoch = await ledger.epoch(identity.bindingGeneration, session!);
      if (epoch === 0) { epoch = 1; await ledger.setEpoch(identity.bindingGeneration, session!, epoch); }
      const row: LiveInvitationRecord = { ...identity, liveSessionId: session!, invitationId: randomUUID(), principalId: principalId!,
        createdBy: invocation.actorId, status: 'pending', epoch, expiresAt: iso(now + args.expiresInSeconds * 1000),
        acceptedAt: null, revokedAt: null, createdAt: iso(now), rowVersion: 1 };
      await ledger.save(row);
      out = { invitationId: row.invitationId, status: 'pending', liveSessionId: row.liveSessionId,
        bindingGeneration: row.bindingGeneration, epoch, expiresAt: row.expiresAt };
    } else if (operation === 'live_invitations') {
      const sessionId: string | null = args.liveSessionId ?? session;
      const own = rows.filter(row => row.liveSessionId === sessionId);
      const visible = owner ? own : own.filter(row => row.principalId === invocation.actorId);
      if (!owner && !visible.length) throw denied();
      const generation = own[0]?.bindingGeneration ?? identity.bindingGeneration;
      const offset = offsetOf(args.cursor, sessionId);
      return { liveSessionId: sessionId, bindingGeneration: generation,
        epoch: sessionId ? await ledger.epoch(generation, sessionId) : 0, rows: visible.slice(offset, offset + PAGE),
        next: offset + PAGE < visible.length ? cursorOf(sessionId!, offset + PAGE) : null };
    } else {
      const row = rows.find(entry => entry.invitationId === args.invitationId);
      if (!row) throw denied();
      if (operation === 'live_accept_invitation') {
        if (row.principalId !== invocation.actorId) throw denied();
        if (row.status === 'active') liveBusy('active_session');
        if (row.status !== 'pending') terminal(row);
        Object.assign(row, { status: 'active', acceptedAt: iso(now), rowVersion: row.rowVersion + 1 });
        await ledger.save(row);
        out = { invitationId: row.invitationId, status: 'active', liveSessionId: row.liveSessionId, epoch: row.epoch,
          expiresAt: row.expiresAt };
      } else {
        if (!owner && row.principalId !== invocation.actorId) throw denied();
        if (row.status !== 'revoked') {
          if (!open(row)) terminal(row);
          const epoch = await ledger.epoch(row.bindingGeneration, row.liveSessionId) + 1;
          await ledger.setEpoch(row.bindingGeneration, row.liveSessionId, epoch);
          for (const other of rows.filter(entry => open(entry) && entry.liveSessionId === row.liveSessionId)) {
            if (other === row) Object.assign(other, { status: 'revoked', revokedAt: iso(now) });
            Object.assign(other, { epoch, rowVersion: other.rowVersion + 1 });
            await ledger.save(other);
          }
          revoked = revokedEvent(row);
        }
        out = { invitationId: row.invitationId, status: 'revoked', epoch: row.epoch };
      }
    }
    out.replayed = false;
    await tx.complete(command!, out as LiveResult);
    return out;
  });
  if (revoked) await port.onRevoked(revoked);
  if (operation !== 'live_invitations') return result;
  const { rows, ...page } = result as { rows: LiveInvitationRecord[] };
  return { ...page, invitations: await Promise.all(rows.map(async row => {
    const person = await port.describePrincipal(invocation.storageScopeId, row.principalId);
    const userRef = person?.userRef ?? UNKNOWN_USER_REF;
    return { invitationId: row.invitationId, invitee: { userRef, displayName: person?.displayName ?? userRef },
      status: row.status, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt };
  })) };
}
