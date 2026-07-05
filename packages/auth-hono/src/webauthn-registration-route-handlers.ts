import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type {
  AuthHonoBeforePersistCredential,
  AuthHonoGenerateRegistrationOptionsInput,
  AuthHonoWebAuthnRegistrationService,
} from './webauthn-registration.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface CreateAuthWebAuthnRegistrationRouteHandlersOptions {
  finalizeRegistration?: AuthHonoFinalizeRegistration;
  prepareRegistrationOptions: AuthHonoPrepareRegistrationOptions;
  resolveRegistrationUser: AuthHonoResolveRegistrationUser;
  service: AuthHonoWebAuthnRegistrationService;
  /**
   * BR-39r L4 — produce a pre-persist hook (atomic invite consume) for this request, run AFTER
   * the resolved user is known and the WebAuthn response will be verified, but BEFORE the
   * credential is persisted. Return `undefined` for requests with no invite. If the returned hook
   * rejects, the credential is NOT created (no orphan) — single-use guaranteed.
   */
  resolveBeforePersist?: (
    input: AuthHonoRegistrationVerifyRequest,
    resolved: AuthHonoResolvedRegistrationUser,
    c: Context
  ) => AuthHonoBeforePersistCredential | undefined | Promise<AuthHonoBeforePersistCredential | undefined>;
}

export type AuthHonoPrepareRegistrationOptions = (
  input: AuthHonoRegistrationOptionsRequest,
  c: Context
) =>
  | Promise<AuthHonoPreparedRegistrationOptions | AuthHonoRouteHandlerError>
  | AuthHonoPreparedRegistrationOptions
  | AuthHonoRouteHandlerError;

export type AuthHonoResolveRegistrationUser = (
  input: AuthHonoRegistrationVerifyRequest,
  c: Context
) =>
  | Promise<AuthHonoResolvedRegistrationUser | AuthHonoRouteHandlerError>
  | AuthHonoResolvedRegistrationUser
  | AuthHonoRouteHandlerError;

export type AuthHonoFinalizeRegistration = (
  result: AuthHonoFinalizeRegistrationInput,
  c: Context
) => Response | Promise<Response>;

export interface AuthHonoFinalizeRegistrationInput {
  credentialId: string;
  request: AuthHonoRegistrationVerifyRequest;
  userId: string;
}

export interface AuthHonoRegistrationOptionsRequest {
  deviceName?: string;
  email: string;
  verificationToken?: string;
}

export interface AuthHonoRegistrationVerifyRequest {
  credential: RegistrationResponseJSON;
  deviceName?: string;
  email: string;
  userId: string;
  verificationToken: string;
}

export interface AuthHonoPreparedRegistrationOptions {
  serviceInput: AuthHonoGenerateRegistrationOptionsInput;
  userId: string;
}

export interface AuthHonoResolvedRegistrationUser {
  userId: string;
}

export interface AuthHonoRouteHandlerError {
  error: {
    code: string;
    message: string;
    status: ContentfulStatusCode;
  };
}

const isRouteHandlerError = (value: unknown): value is AuthHonoRouteHandlerError =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'error' in (value as Record<string, unknown>) &&
      typeof (value as { error?: unknown }).error === 'object' &&
      (value as { error?: { code?: unknown } }).error?.code !== undefined
  );

const registrationOptionsSchema = z.object({
  deviceName: z.string().max(100).optional(),
  email: z.string().email(),
  verificationToken: z.string().optional(),
});

const registrationVerifySchema = z.object({
  credential: z.custom<RegistrationResponseJSON>(
    (value) => Boolean(value && typeof value === 'object' && 'response' in value)
  ),
  deviceName: z.string().max(100).optional(),
  email: z.string().email(),
  userId: z.string().min(1),
  verificationToken: z.string().min(1),
});

export const createAuthWebAuthnRegistrationRouteHandlers = (
  options: CreateAuthWebAuthnRegistrationRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async createPasskeyRegistrationOptions(c) {
    const input = await parseJson(c, registrationOptionsSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const prepared = await options.prepareRegistrationOptions(input.value, c);

    if (isRouteHandlerError(prepared)) {
      return simpleError(c, prepared.error.status, prepared.error.code, prepared.error.message);
    }

    const registrationOptions = await options.service.generateRegistrationOptions(
      prepared.serviceInput
    );

    return c.json({
      options: registrationOptions,
      userId: prepared.userId,
    });
  },

  async verifyPasskeyRegistration(c) {
    const input = await parseJson(c, registrationVerifySchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const challenge = extractChallenge(input.value.credential);

    if (!challenge) {
      return simpleError(c, 400, 'invalid_credential', 'Credential challenge is missing or invalid.');
    }

    const registrationUser = await options.resolveRegistrationUser(input.value, c);

    if (isRouteHandlerError(registrationUser)) {
      return simpleError(
        c,
        registrationUser.error.status,
        registrationUser.error.code,
        registrationUser.error.message
      );
    }

    const beforePersist = options.resolveBeforePersist
      ? await options.resolveBeforePersist(input.value, registrationUser, c)
      : undefined;

    const result = await options.service.verifyRegistration({
      beforePersist,
      credential: input.value.credential,
      deviceName: input.value.deviceName,
      expectedChallenge: challenge,
      userId: registrationUser.userId,
    });

    if (!result.verified) {
      return serviceError(c, result.error);
    }

    if (options.finalizeRegistration) {
      return options.finalizeRegistration(
        {
          credentialId: result.credentialId,
          request: input.value,
          userId: registrationUser.userId,
        },
        c
      );
    }

    return c.json({
      credentialId: result.credentialId,
      success: true,
      userId: registrationUser.userId,
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

const extractChallenge = (credential: RegistrationResponseJSON): string | null => {
  const clientDataJson = credential.response?.clientDataJSON;

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
