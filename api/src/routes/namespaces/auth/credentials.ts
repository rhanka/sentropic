import {
  createAuthCredentialRouteHandlers,
  type AuthHonoCredentialPort,
  type AuthHonoCredentialRecord,
} from '@sentropic/auth-hono';

import { validateSession } from '../../../services/session-manager';
import { getWebAuthnConfig } from '../../../services/webauthn-config';
import {
  compareAndSwapCmCredentialCounter,
  createCmCredential,
  findCmCredentialByCredentialId,
  findCmCredentialById,
  listCmCredentialsForUser,
  renameCmCredential,
  revokeCmCredential,
  type CmCredentialRecord,
} from '../../../services/identity/cm-proofs';


const credentialPort: AuthHonoCredentialPort = {
  async create(input) {
    const credential = await createCmCredential({
      userId: input.userId,
      credentialId: input.credentialId,
      publicKey: serializePublicKey(input.publicKey),
      counter: input.counter,
      transports: input.transports ?? [],
      name: input.name ?? input.deviceType ?? 'Unknown Device',
      deviceType: input.deviceType ?? null,
      backedUp: input.backedUp ?? null,
      rpId: getWebAuthnConfig().rpID,
      now: new Date(),
    });

    return toAuthHonoCredential(credential);
  },

  async findByCredentialId(credentialId) {
    const credential = await findCmCredentialByCredentialId(credentialId);
    return credential ? toAuthHonoCredential(credential) : null;
  },

  async findById(credentialRecordId) {
    const credential = await findCmCredentialById(credentialRecordId);
    return credential ? toAuthHonoCredential(credential) : null;
  },

  async listForUser(userId) {
    const credentials = await listCmCredentialsForUser(userId);
    return credentials.map(toAuthHonoCredential);
  },

  async rename(credentialRecordId, userId, name) {
    const renamed = await renameCmCredential(credentialRecordId, userId, name);
    if (!renamed) return null;
    const credential = await findCmCredentialById(credentialRecordId);
    return credential ? toAuthHonoCredential(credential) : null;
  },

  async revoke(credentialRecordId, userId) {
    return revokeCmCredential(credentialRecordId, userId);
  },

  async updateCounter(credentialId, counter, lastUsedAt) {
    const current = await findCmCredentialByCredentialId(credentialId);
    if (!current) return;
    await compareAndSwapCmCredentialCounter({
      credentialId,
      userId: current.userId,
      expectedCounter: current.counter,
      newCounter: counter,
      now: lastUsedAt ?? new Date(),
    });
  },
};

export const credentialHandlers = createAuthCredentialRouteHandlers({
  credentials: credentialPort,
  resolveSession: async (c) => {
    const sessionToken =
      c.req.header('cookie')?.match(/session=([^;]+)/)?.[1] ??
      c.req.header('authorization')?.replace('Bearer ', '');

    if (!sessionToken) {
      return null;
    }

    const session = await validateSession(sessionToken);
    return session ? { userId: session.userId } : null;
  },
});


const serializePublicKey = (publicKey: Uint8Array | ArrayBuffer | string): string => {
  if (typeof publicKey === 'string') {
    return publicKey;
  }

  const bytes = publicKey instanceof Uint8Array ? publicKey : new Uint8Array(publicKey);
  return Buffer.from(bytes).toString('base64url');
};

const toAuthHonoCredential = (
  credential: CmCredentialRecord
): AuthHonoCredentialRecord => ({
  backedUp: credential.backedUp ?? false,
  counter: credential.counter,
  createdAt: credential.createdAt,
  credentialId: credential.credentialId,
  deviceType: credential.deviceType,
  id: credential.id,
  lastUsedAt: credential.lastUsedAt,
  name: credential.name,
  publicKey: credential.publicKey,
  revokedAt: credential.revokedAt,
  transports: credential.transports ? [...credential.transports] : null,
  userId: credential.userId,
});
