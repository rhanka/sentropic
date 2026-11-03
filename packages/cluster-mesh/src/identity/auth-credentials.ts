import type { AuthHonoCredentialPort, AuthHonoCredentialRecord } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { WebAuthnCredentialV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import type { WebAuthnAttempt } from './auth-webauthn.js';
import { finishAuthCompletion, refuseWebAuthn } from './auth-abort.js';

export const authCredentialPort = <H>(input: IdentityAuthBindingInput<H>, check: () => void, state: WebAuthnAttempt): AuthHonoCredentialPort => {
  const { tx } = input;
  const snapshots = new Map<string, WebAuthnCredentialV1>();
  const project = (record: WebAuthnCredentialV1 | null): AuthHonoCredentialRecord | null => {
    if (!record) return null;
    snapshots.set(record.credentialId, record);
    return { id: record.proofId, userId: record.userId, credentialId: record.credentialId, publicKey: new Uint8Array(Buffer.from(record.publicKeyCose, 'base64url')),
      counter: record.counter, transports: record.transports ? [...record.transports] : null, name: record.deviceName, deviceType: record.deviceType,
      backedUp: record.backedUp, lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null, createdAt: new Date(record.createdAt), revokedAt: record.revokedAt ? new Date(record.revokedAt) : null };
  };
  return {
    findById: async (id) => { check(); return project(await tx.custody.credentials.findById(id)); },
    findByCredentialId: async (id) => {
      check(); const row = await tx.custody.credentials.findByCredentialId(id);
      if (row && !row.revokedAt && state.flow === 'authentication') {
        if (row.rpId !== input.rp.id) refuseWebAuthn('authentication', 'authentication_verification_failed', 'Authentication verification failed.', 401);
        state.owner = row.userId;
      }
      return project(row);
    },
    listForUser: async (id) => { check(); return (await tx.custody.credentials.listForUser(id)).map((record) => project(record)!); },
    create: async (value) => {
      check();
      const bytes = typeof value.publicKey === 'string' ? Buffer.from(value.publicKey, 'base64url')
        : value.publicKey instanceof ArrayBuffer ? new Uint8Array(value.publicKey) : new Uint8Array(value.publicKey);
      const verified = state.registration;
      if (!verified || state.owner !== value.userId || verified.credential.id !== value.credentialId || verified.credential.counter !== value.counter
        || (state.completionOwner !== null && state.completionOwner !== value.userId)
        || !Buffer.from(verified.credential.publicKey).equals(Buffer.from(bytes))) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(value.userId);
      const record: WebAuthnCredentialV1 = { proofId: input.hostPorts.random.uuid(), userId: value.userId, credentialId: value.credentialId,
        publicKeyCose: Buffer.from(bytes).toString('base64url'), counter: value.counter, revision: 0, rpId: input.rp.id,
        deviceName: value.name ?? null, transports: value.transports ?? null, uv: state.registrationUv, deviceType: value.deviceType ?? null,
        backedUp: value.backedUp ?? null, createdAt: input.hostPorts.clock.now().toISOString(), lastUsedAt: null, revokedAt: null };
      await tx.custody.credentials.insert(record);
      state.completionOwner = value.userId; state.registration = undefined;
      return project(record)!;
    },
    updateCounter: async (id, counter, at) => {
      check();
      const snapshot = snapshots.get(id);
      if (!snapshot || state.assertion?.credentialId !== id || state.assertion.newCounter !== counter) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      if (state.completionOwner !== null && state.completionOwner !== snapshot.userId) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(snapshot.userId);
      const record = await tx.custody.credentials.compareAndSwapCounter({ proofId: snapshot.proofId, userId: snapshot.userId, expectedCounter: snapshot.counter,
        expectedRevision: snapshot.revision, newCounter: counter, at: (at ?? input.hostPorts.clock.now()).toISOString() });
      snapshots.set(id, record);
      state.completionOwner = record.userId;
      state.assertion = undefined;
    },
    rename: async (id, userId, name) => {
      check(); await tx.lockSubject(userId);
      const existing = await tx.custody.credentials.findById(id);
      if (!existing || existing.userId !== userId || existing.revokedAt) return finishAuthCompletion('credential_rename', null);
      await tx.custody.credentials.rename(id, userId, name);
      return finishAuthCompletion('credential_rename', project(await tx.custody.credentials.findById(id)));
    },
    revoke: async (id, userId) => {
      check(); await tx.lockSubject(userId);
      const existing = await tx.custody.credentials.findById(id);
      if (!existing || existing.userId !== userId) return finishAuthCompletion('credential_revoke', false);
      if (existing.revokedAt) return true;
      await tx.custody.credentials.revoke(id, userId, input.hostPorts.clock.now().toISOString());
      return true;
    },
  };
};
