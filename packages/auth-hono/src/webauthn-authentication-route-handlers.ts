import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type {
  AuthHonoGenerateAuthenticationOptionsInput,
  AuthHonoWebAuthnAuthenticationService,
} from './webauthn-authentication.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface CreateAuthWebAuthnAuthenticationRouteHandlersOptions {
  resolveAuthenticationOptions: AuthHonoResolveAuthenticationOptions;
  service: AuthHonoWebAuthnAuthenticationService;
}

export type AuthHonoResolveAuthenticationOptions = (
  input: AuthHonoAuthenticationOptionsRequest,
  c: Context
) => Promise<AuthHonoGenerateAuthenticationOptionsInput> | AuthHonoGenerateAuthenticationOptionsInput;

export interface AuthHonoAuthenticationOptionsRequest {
  email?: string;
}

const authenticationOptionsSchema = z.object({
  email: z.string().email().optional(),
});

const authenticationVerifySchema = z.object({
  credential: z.custom<AuthenticationResponseJSON>(
    (value) => Boolean(value && typeof value === 'object' && 'response' in value)
  ),
});

export const createAuthWebAuthnAuthenticationRouteHandlers = (
  options: CreateAuthWebAuthnAuthenticationRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async createPasskeyAuthenticationOptions(c) {
    const input = await parseJson(c, authenticationOptionsSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const serviceInput = await options.resolveAuthenticationOptions(input.value, c);
    const authenticationOptions = await options.service.generateAuthenticationOptions(serviceInput);

    return c.json({ options: authenticationOptions });
  },

  async verifyPasskeyAuthentication(c) {
    const input = await parseJson(c, authenticationVerifySchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const challenge = extractChallenge(input.value.credential);

    if (!challenge) {
      return simpleError(c, 400, 'invalid_credential', 'Credential challenge is missing or invalid.');
    }

    const result = await options.service.verifyAuthentication({
      credential: input.value.credential,
      expectedChallenge: challenge,
    });

    if (!result.verified) {
      return serviceError(c, result.error);
    }

    return c.json({
      credentialId: result.credentialId,
      success: true,
      userId: result.userId,
    });
  },
});

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

const extractChallenge = (credential: AuthenticationResponseJSON): string | null => {
  const clientDataJson = credential.response.clientDataJSON;

  if (!clientDataJson) {
    return null;
  }

  try {
    const json = JSON.parse(decodeBase64Url(clientDataJson)) as { challenge?: unknown };
    return typeof json.challenge === 'string' && json.challenge.length > 0 ? json.challenge : null;
  } catch {
    return null;
  }
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return atob(padded);
};

const invalidRequest = (c: Context, error: z.ZodError): Response =>
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

const serviceError = (
  c: Context,
  error: { code: string; message: string; status: number }
): Response => simpleError(c, error.status as ContentfulStatusCode, error.code, error.message);

const simpleError = (
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string
): Response =>
  c.json(
    {
      error: {
        code,
        message,
      },
    },
    status
  );
