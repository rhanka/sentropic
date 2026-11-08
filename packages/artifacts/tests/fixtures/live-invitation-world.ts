import { vi } from 'vitest';
import { liveWitness } from './live-world.js';
import type { LiveStore } from '../../src/server/live-store.js';
import type { LiveInvitationRevoked } from '../../src/server/live-contracts.js';

export const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/** Owner alice; `ref-<id>` resolves to principal `<id>`; dave holds no code rights. */
export function invitationWorld(options: { store?: LiveStore; now?: () => number; qualified?: boolean } = {}) {
  const onRevoked = vi.fn(async (_event: LiveInvitationRevoked) => undefined);
  const invitations = { qualified: options.qualified ?? true, onRevoked,
    resolvePrincipal: async (_scope: string, userRef: string) => userRef.startsWith('ref-') ? userRef.slice(4) : undefined,
    describePrincipal: async (_scope: string, principalId: string) =>
      ({ userRef: 'ref-' + principalId, displayName: principalId.toUpperCase(), email: principalId + '@example.test' }) };
  const w = liveWitness({ store: options.store, now: options.now, invitations,
    rights: actorId => actorId === 'dave' ? { canReadCode: false } : {} });
  let n = 0;
  const as = (actorId: string, operation: string, args: Record<string, unknown> = {}) => w.service.execute(operation,
    { artifactId: w.binding.artifactId, ...args }, { ...w.context, actorId, invocationId: `${actorId}-${++n}` });
  const identity = { storageScopeId: w.binding.storageScopeId, artifactId: w.binding.artifactId,
    bindingGeneration: w.binding.generation };
  const start = async () => {
    await w.write({ files: [{ path: 'ui/a.ts', text: 'live ' + ++n }] }); await settle();
    return (await w.status()).liveSessionId as string;
  };
  /** The worker settled a stop: the next owner write opens a new live session. */
  const stop = () => w.store.transaction(identity, async tx => { tx.record!.runtime!.phase = 'DORMANT'; });
  const invite = (liveSessionId: string, who: string, over: Record<string, unknown> = {}) => as('alice', 'live_invite',
    { liveSessionId, userRef: 'ref-' + who, expiresInSeconds: 900, idempotencyKey: `invite-${who}-${liveSessionId}`, ...over });
  const accept = (who: string, invitationId: string, key = 'accept-' + invitationId) =>
    as(who, 'live_accept_invitation', { invitationId, idempotencyKey: key });
  const revoke = (who: string, invitationId: string, key = `revoke-${who}-${invitationId}`) =>
    as(who, 'live_revoke_invitation', { invitationId, idempotencyKey: key });
  const list = (who: string, args: Record<string, unknown> = {}) => as(who, 'live_invitations', args);
  return { w, as, identity, start, stop, invite, accept, revoke, list, onRevoked };
}
