import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type { AuthHonoEmailVerificationService } from './email-verification.js';
import type { AuthHonoMagicLinkService, AuthHonoRequestMagicLinkResult } from './magic-link.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface CreateAuthEmailRouteHandlersOptions {
  service: AuthHonoEmailVerificationService;
}

export interface CreateAuthMagicLinkRouteHandlersOptions {
  formatRequestMagicLinkSuccess?: (
    result: Extract<AuthHonoRequestMagicLinkResult, { success: true }>
  ) => AuthHonoMagicLinkRequestSuccessResponse;
  service: AuthHonoMagicLinkService;
}

export interface AuthHonoMagicLinkRequestSuccessResponse {
  success: true;
  [key: string]: unknown;
}

interface AuthHonoHttpServiceError {
  code: string;
  message: string;
  status: number;
}

const requestEmailCodeSchema = z.object({
  email: z.string().email(),
});

const verifyEmailCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  email: z.string().email(),
});

const requestMagicLinkSchema = z.object({
  email: z.string().email(),
});

const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
});

export const createAuthEmailRouteHandlers = (
  options: CreateAuthEmailRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async requestEmailCode(c) {
    const input = await parseJson(c, requestEmailCodeSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const result = await options.service.requestEmailCode(input.value);

    if (!result.success) {
      return serviceError(c, result.error);
    }

    return c.json({
      delivery: 'email',
      expiresAt: result.expiresAt.toISOString(),
      success: true,
    });
  },

  async verifyEmailCode(c) {
    const input = await parseJson(c, verifyEmailCodeSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const result = await options.service.verifyEmailCode(input.value);

    if (!result.valid) {
      return serviceError(c, result.error);
    }

    return c.json({
      success: true,
      verificationToken: result.verificationToken,
    });
  },
});

export const createAuthMagicLinkRouteHandlers = (
  options: CreateAuthMagicLinkRouteHandlersOptions
): AuthHonoRouteHandlers => ({
  async requestMagicLink(c) {
    const input = await parseJson(c, requestMagicLinkSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const result = await options.service.requestMagicLink(input.value);

    if (!result.success) {
      return serviceError(c, result.error);
    }

    return c.json(formatRequestMagicLinkSuccess(options, result));
  },

  async verifyMagicLink(c) {
    const input = await parseJson(c, verifyMagicLinkSchema);

    if (!input.ok) {
      return invalidRequest(c, input.error);
    }

    const result = await options.service.verifyMagicLink(input.value);

    if (!result.valid) {
      return serviceError(c, result.error);
    }

    return c.json({
      success: true,
      user: {
        displayName: result.user.displayName,
        email: result.email,
        id: result.user.id,
        role: result.user.role,
      },
    });
  },
});

const formatRequestMagicLinkSuccess = (
  options: CreateAuthMagicLinkRouteHandlersOptions,
  result: Extract<AuthHonoRequestMagicLinkResult, { success: true }>
): AuthHonoMagicLinkRequestSuccessResponse =>
  options.formatRequestMagicLinkSuccess
    ? options.formatRequestMagicLinkSuccess(result)
    : {
        delivery: 'magic_link',
        expiresAt: result.expiresAt.toISOString(),
        success: true,
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

const serviceError = (c: Context, error: AuthHonoHttpServiceError): Response =>
  c.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.status as ContentfulStatusCode
  );
