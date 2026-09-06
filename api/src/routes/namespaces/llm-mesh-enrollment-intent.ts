import { z } from 'zod';

const accountLabel = z.string().trim().max(120).optional().nullable();
const enrollmentId = z.string().trim().min(1);
const authorizationCode = z.string().trim().min(1);

const schemas = {
  'codex:start': z.object({ accountLabel }),
  'codex:complete': z.object({ enrollmentId, accountLabel }),
  'anthropic:start': z.object({ accountLabel }),
  'anthropic:complete': z.object({ enrollmentId, authorizationCode, accountLabel }),
  'anthropic:import': z.object({
    accessToken: z.string().trim().min(1),
    refreshToken: z.string().trim().min(1),
    expiresAt: z.string().trim().optional().nullable(),
    subscriptionType: z.string().trim().max(60).optional().nullable(),
    rateLimitTier: z.string().trim().max(60).optional().nullable(),
    accountLabel,
  }),
  'antigravity:start': z.object({
    accountLabel,
    redirectPort: z.number().int().min(0).max(65535).optional(),
  }),
  'antigravity:complete': z.object({ enrollmentId, authorizationCode, accountLabel }),
  'antigravity:import': z.object({
    accessToken: z.string().trim().min(1),
    refreshToken: z.string().trim().min(1),
    expiresAt: z.string().trim().optional().nullable(),
    project: z.string().trim().max(200).optional().nullable(),
    accountLabel,
  }),
} as const;

export type LlmMeshEnrollmentIntentKey = keyof typeof schemas;

export type LlmMeshEnrollmentIntent = {
  readonly key: LlmMeshEnrollmentIntentKey;
  readonly payload: Record<string, unknown>;
};

export const parseLlmMeshEnrollmentIntent = async (
  providerId: string,
  action: string,
  request: Request,
): Promise<LlmMeshEnrollmentIntent | undefined> => {
  const key = `${providerId}:${action}` as LlmMeshEnrollmentIntentKey;
  const schema = schemas[key];
  if (!schema) return undefined;
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { key, payload: parsed.data as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  }
};
