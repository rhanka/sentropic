import type { AuthHonoCredentialPort, AuthHonoCredentialRecord } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { WebAuthnCredentialV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

export const authCredentialPort = <H>(input: IdentityAuthBindingInput<H>, check: () => void, verifiedUv: () => boolean): AuthHonoCredentialPort => {
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
    findByCredentialId: async (id) => { check(); return project(await tx.custody.credentials.findByCredentialId(id)); },
    listForUser: async (id) => { check(); return (await tx.custody.credentials.listForUser(id)).map((record) => project(record)!); },
    create: async (value) => {
      check(); await tx.lockSubject(value.userId);
      const bytes = typeof value.publicKey === 'string' ? Buffer.from(value.publicKey, 'base64url')
        : value.publicKey instanceof ArrayBuffer ? new Uint8Array(value.publicKey) : new Uint8Array(value.publicKey);
      const record: WebAuthnCredentialV1 = { proofId: input.hostPorts.random.uuid(), userId: value.userId, credentialId: value.credentialId,
        publicKeyCose: Buffer.from(bytes).toString('base64url'), counter: value.counter, revision: 0, rpId: input.rp.id,
        deviceName: value.name ?? null, transports: value.transports ?? null, uv: verifiedUv(), deviceType: value.deviceType ?? null,
        backedUp: value.backedUp ?? null, createdAt: input.hostPorts.clock.now().toISOString(), lastUsedAt: null, revokedAt: null };
      await tx.custody.credentials.insert(record);
      return project(record)!;
    },
    updateCounter: async (id, counter, at) => {
      check();
      const snapshot = snapshots.get(id);
      if (!snapshot) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(snapshot.userId);
      const record = await tx.custody.credentials.compareAndSwapCounter({ proofId: snapshot.proofId, userId: snapshot.userId, expectedCounter: snapshot.counter,
        expectedRevision: snapshot.revision, newCounter: counter, at: (at ?? input.hostPorts.clock.now()).toISOString() });
      snapshots.set(id, record);
    },
    rename: async (id, userId, name) => {
      check(); await tx.lockSubject(userId);
      const existing = await tx.custody.credentials.findById(id);
      if (!existing || existing.userId !== userId || existing.revokedAt) return null;
      await tx.custody.credentials.rename(id, userId, name);
      return project(await tx.custody.credentials.findById(id));
    },
    revoke: async (id, userId) => {
      check(); await tx.lockSubject(userId);
      const existing = await tx.custody.credentials.findById(id);
      if (!existing || existing.userId !== userId || existing.revokedAt) return false;
      await tx.custody.credentials.revoke(id, userId, input.hostPorts.clock.now().toISOString());
      return true;
    },
  };
};
