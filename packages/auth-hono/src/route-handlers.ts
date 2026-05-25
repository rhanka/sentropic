import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type { AuthHonoServiceError, AuthHonoEmailVerificationService } from './email-verification.js';
import type { AuthHonoRouteHandlers } from './router.js';

export interface CreateAuthEmailRouteHandlersOptions {
  service: AuthHonoEmailVerificationService;
}

const requestEmailCodeSchema = z.object({
  email: z.string().email(),
});

const verifyEmailCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  email: z.string().email(),
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

const serviceError = (c: Context, error: AuthHonoServiceError): Response =>
  c.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.status as ContentfulStatusCode
  );
