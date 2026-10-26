import { zValidator as honoZValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';

// Serialize issues explicitly: Zod 4 makes them non-enumerable on ZodError.
export function zValidator<Schema extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: Schema,
) {
  return honoZValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: { issues: result.error.issues, name: 'ZodError' } }, 400);
    }
  });
}
