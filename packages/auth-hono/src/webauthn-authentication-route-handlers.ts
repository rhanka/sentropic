import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type {
  AuthHonoGenerateAuthenticationOptionsInput,
  AuthHonoWebAuthnAuthenticationService,
} from './webauthn-authentication.js';
import type { AuthHonoRouteHandlers } from './router.js';
import type { AuthHonoRouteHandlerError } from './webauthn-registration-route-handlers.js';

export interface CreateAuthWebAuthnAuthenticationRouteHandlersOptions {
  finalizeAuthentication?: AuthHonoFinalizeAuthentication;
  resolveAuthenticationOptions: AuthHonoResolveAuthenticationOptions;
  service: AuthHonoWebAuthnAuthenticationService;
}

export type AuthHonoResolveAuthenticationOptions = (
  input: AuthHonoAuthenticationOptionsRequest,
  c: Context
) =>
  | Promise<AuthHonoGenerateAuthenticationOptionsInput | AuthHonoRouteHandlerError>
  | AuthHonoGenerateAuthenticationOptionsInput
  | AuthHonoRouteHandlerError;

export type AuthHonoFinalizeAuthentication = (
  result: AuthHonoFinalizeAuthenticationInput,
  c: Context
) => Response | Promise<Response>;

export interface AuthHonoFinalizeAuthenticationInput {
  credentialId: string;
  request: AuthHonoAuthenticationVerifyRequest;
  userId: string;
}

export interface AuthHonoAuthenticationOptionsRequest {
  email?: string;
}

export interface AuthHonoAuthenticationVerifyRequest {
  credential: AuthenticationResponseJSON;
  deviceName?: string;
}

const isRouteHandlerError = (value: unknown): value is AuthHonoRouteHandlerError =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'error' in (value as Record<string, unknown>) &&
      typeof (value as { error?: unknown }).error === 'object' &&
      (value as { error?: { code?: unknown } }).error?.code !== undefined
  );

const authenticationOptionsSchema = z.object({
  email: z.string().email().optional(),
});

const authenticationVerifySchema = z.object({
  credential: z.custom<AuthenticationResponseJSON>(
    (value) => Boolean(value && typeof value === 'object' && 'response' in value)
  ),
  deviceName: z.string().max(100).optional(),
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

    if (isRouteHandlerError(serviceInput)) {
      return simpleError(
        c,
        serviceInput.error.status,
        serviceInput.error.code,
        serviceInput.error.message
      );
    }

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

    if (options.finalizeAuthentication) {
      return options.finalizeAuthentication(
        {
          credentialId: result.credentialId,
          request: input.value,
          userId: result.userId,
        },
        c
      );
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
