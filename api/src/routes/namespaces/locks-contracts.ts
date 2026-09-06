import { z } from 'zod';

export const lockObjectTypeSchema = z.enum([
  'organization',
  'folder',
  'initiative',
  'usecase',
]);

export const lockScopeSchema = z.object({
  objectType: lockObjectTypeSchema,
  objectId: z.string().min(1),
});

export const acquireLockSchema = lockScopeSchema.extend({
  ttlMs: z.number().int().min(5_000).max(60_000).optional(),
});

export const requestUnlockSchema = lockScopeSchema.extend({
  message: z.string().max(500).optional(),
});

export const isLocksHttpError = (error: unknown): error is { status: number } => {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return typeof (error as Record<string, unknown>).status === 'number';
};
