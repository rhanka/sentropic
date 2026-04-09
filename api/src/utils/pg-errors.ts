/**
 * Utility to unwrap Postgres error codes from potentially wrapped errors.
 *
 * Drizzle v0.44+ wraps driver errors in DrizzleQueryError, moving the
 * original Postgres error (with `.code`, `.constraint`, etc.) into `.cause`.
 * This helper walks the cause chain so callers can detect specific PG codes
 * regardless of wrapping depth.
 */

type PgErrorFields = {
  code: string;
  constraint?: string;
  message?: string;
};

/**
 * Walk the `.cause` chain (up to 5 levels) looking for an object whose
 * `.code` matches the given Postgres error code (e.g. '23505').
 */
export function findPgError(
  error: unknown,
  pgCode: string,
): PgErrorFields | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const maybe = current as {
        code?: unknown;
        constraint?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      if (typeof maybe.code === 'string' && maybe.code === pgCode) {
        return {
          code: maybe.code,
          constraint:
            typeof maybe.constraint === 'string'
              ? maybe.constraint
              : undefined,
          message:
            typeof maybe.message === 'string' ? maybe.message : undefined,
        };
      }
      current = maybe.cause;
    } else {
      break;
    }
  }
  return null;
}
