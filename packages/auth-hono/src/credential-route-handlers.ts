import type { Context } from 'hono';
import { z } from 'zod';

import type { AuthHonoCredentialPort, AuthHonoCredentialRecord } from './ports.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface AuthHonoCredentialRouteSession {
  userId: string;
}

export type AuthHonoCredentialSessionResolver = (
  c: Context
) => Promise<AuthHonoCredentialRouteSession | null>;

export interface CreateAuthCredentialRouteHandlersOptions {
  credentials: AuthHonoCredentialPort;
  resolveSession: AuthHonoCredentialSessionResolver;
}

const renameCredentialSchema = z.object({
  deviceName: z.string().min(1).max(100),
});

export const createAuthCredentialRouteHandlers = (
  options: CreateAuthCredentialRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async listCredentials(c) {
    const session = await options.resolveSession(c);

    if (!session) {
      return authenticationRequired(c);
    }

    const credentials = await options.credentials.listForUser(session.userId);
    return c.json({ credentials: credentials.map(toCredentialResponse) });
  },

  async renameCredential(c) {
    const session = await options.resolveSession(c);

    if (!session) {
      return authenticationRequired(c);
    }

    const parsed = await parseJson(c, renameCredentialSchema);

    if (!parsed.ok) {
      return invalidInput(c, parsed.error);
    }

    const checked = await requireOwnedCredential(c, options, session.userId);

    if (!checked.ok) {
      return checked.response;
    }

    const renamed = await options.credentials.rename(
      checked.credential.id,
      session.userId,
      parsed.value.deviceName
    );

    if (!renamed) {
      return credentialNotFound(c);
    }

    return c.json({ credential: toCredentialResponse(renamed), success: true });
  },

  async revokeCredential(c) {
    const session = await options.resolveSession(c);

    if (!session) {
      return authenticationRequired(c);
    }

    const checked = await requireOwnedCredential(c, options, session.userId);

    if (!checked.ok) {
      return checked.response;
    }

    const revoked = await options.credentials.revoke(checked.credential.id, session.userId);

    if (!revoked) {
      return credentialNotFound(c);
    }

    return c.json({ success: true });
  },
});

const toCredentialResponse = (credential: AuthHonoCredentialRecord) => ({
  backedUp: credential.backedUp,
  counter: credential.counter,
  createdAt: credential.createdAt.toISOString(),
  credentialId: credential.credentialId,
  deviceName: credential.name ?? 'Unnamed credential',
  deviceType: credential.deviceType,
  id: credential.id,
  lastUsedAt: credential.lastUsedAt ? credential.lastUsedAt.toISOString() : null,
  transports: credential.transports,
});

const requireOwnedCredential = async (
  c: Context,
  options: CreateAuthCredentialRouteHandlersOptions,
  userId: string
): Promise<{ credential: AuthHonoCredentialRecord; ok: true } | { ok: false; response: Response }> => {
  const credentialId = c.req.param('id');

  if (!credentialId) {
    return { ok: false, response: credentialNotFound(c) };
  }

  const credential = await options.credentials.findById(credentialId);

  if (!credential) {
    return { ok: false, response: credentialNotFound(c) };
  }

  if (credential.userId !== userId) {
    return { ok: false, response: forbidden(c) };
  }

  return { credential, ok: true };
};

const parseJson = async <T extends z.ZodTypeAny>(
  c: Context,
  schema: T
): Promise<{ ok: true; value: z.infer<T> } | { error: z.ZodError; ok: false }> => {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return { error: parsed.error, ok: false };
  }

  return { ok: true, value: parsed.data };
};

const authenticationRequired = (c: Context): Response =>
  c.json(
    {
      error: {
        code: 'authentication_required',
        message: 'Authentication is required to access credentials.',
      },
    },
    401
  );

const invalidInput = (c: Context, error: z.ZodError): Response =>
  c.json(
    {
      error: {
        code: 'invalid_input',
        details: error.errors,
        message: 'Invalid request data.',
      },
    },
    400
  );

const credentialNotFound = (c: Context): Response =>
  c.json({ error: { code: 'credential_not_found', message: 'Credential not found.' } }, 404);

const forbidden = (c: Context): Response =>
  c.json(
    {
      error: {
        code: 'forbidden',
        message: 'Credential does not belong to the authenticated user.',
      },
    },
    403
  );
