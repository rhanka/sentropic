import {
  createAuthCredentialRouteHandlers,
  type AuthHonoCredentialPort,
  type AuthHonoCredentialRecord,
} from '@sentropic/auth-hono';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../../../db/client';
import { webauthnCredentials } from '../../../db/schema';
import { validateSession } from '../../../services/session-manager';

export const credentialsRouter = new Hono();

const credentialPort: AuthHonoCredentialPort = {
  async create(input) {
    const [credential] = await db
      .insert(webauthnCredentials)
      .values({
        counter: input.counter,
        credentialId: input.credentialId,
        deviceName: input.name ?? input.deviceType ?? 'Unknown Device',
        id: crypto.randomUUID(),
        publicKeyCose: serializePublicKey(input.publicKey),
        transportsJson: JSON.stringify(input.transports ?? []),
        userId: input.userId,
        uv: input.backedUp ?? false,
      })
      .returning();

    return toAuthHonoCredential(credential);
  },

  async findByCredentialId(credentialId) {
    const [credential] = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialId))
      .limit(1);

    return credential ? toAuthHonoCredential(credential) : null;
  },

  async findById(credentialRecordId) {
    const [credential] = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, credentialRecordId))
      .limit(1);

    return credential ? toAuthHonoCredential(credential) : null;
  },

  async listForUser(userId) {
    const credentials = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId));

    return credentials.map(toAuthHonoCredential);
  },

  async rename(credentialRecordId, userId, name) {
    const [credential] = await db
      .update(webauthnCredentials)
      .set({ deviceName: name })
      .where(
        and(
          eq(webauthnCredentials.id, credentialRecordId),
          eq(webauthnCredentials.userId, userId)
        )
      )
      .returning();

    return credential ? toAuthHonoCredential(credential) : null;
  },

  async revoke(credentialRecordId, userId) {
    const revoked = await db
      .delete(webauthnCredentials)
      .where(
        and(
          eq(webauthnCredentials.id, credentialRecordId),
          eq(webauthnCredentials.userId, userId)
        )
      )
      .returning({ id: webauthnCredentials.id });

    return revoked.length > 0;
  },

  async updateCounter(credentialId, counter, lastUsedAt) {
    await db
      .update(webauthnCredentials)
      .set({ counter, lastUsedAt })
      .where(eq(webauthnCredentials.credentialId, credentialId));
  },
};

const handlers = createAuthCredentialRouteHandlers({
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

credentialsRouter.get('/', handlers.listCredentials!);
credentialsRouter.put('/:id', handlers.renameCredential!);
credentialsRouter.delete('/:id', handlers.revokeCredential!);

const serializePublicKey = (publicKey: Uint8Array | ArrayBuffer | string): string => {
  if (typeof publicKey === 'string') {
    return publicKey;
  }

  const bytes = publicKey instanceof Uint8Array ? publicKey : new Uint8Array(publicKey);
  return Buffer.from(bytes).toString('base64url');
};

const toAuthHonoCredential = (
  credential: typeof webauthnCredentials.$inferSelect
): AuthHonoCredentialRecord => ({
  backedUp: credential.uv,
  counter: credential.counter,
  createdAt: credential.createdAt,
  credentialId: credential.credentialId,
  deviceType: null,
  id: credential.id,
  lastUsedAt: credential.lastUsedAt,
  name: credential.deviceName,
  publicKey: credential.publicKeyCose,
  revokedAt: null,
  transports: parseTransports(credential.transportsJson),
  userId: credential.userId,
});

const parseTransports = (transportsJson: string | null): string[] | null => {
  if (!transportsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(transportsJson) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : null;
  } catch {
    return null;
  }
};
