/**
 * Structural recognition of mesh routing failures (Lot 1 unknown-model 404).
 *
 * The gateway and mesh are versioned separately, so a duplicated mesh install
 * can break `instanceof`. Recognize `RoutePlanError` / `RouteQuoteError` by
 * `instanceof` OR by the exact `name` plus the exact `code`. A bare code, a
 * message containing "unknown model", or an arbitrary `Error` with that code
 * does NOT qualify. Diagnostic messages are never read for classification.
 */
import { RoutePlanError, RouteQuoteError } from '@sentropic/llm-mesh';

const isNamedCode = (error: unknown, name: string, code: string): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return record.name === name && record.code === code;
};

/** True for a plan-path failure with exactly the given code. */
export const isRoutePlanError = (error: unknown, code: string): boolean => {
  if (error instanceof RoutePlanError) {
    return error.code === code;
  }
  return isNamedCode(error, 'RoutePlanError', code);
};

/** True for a quote-path failure with exactly the given code. */
export const isRouteQuoteError = (error: unknown, code: string): boolean => {
  if (error instanceof RouteQuoteError) {
    return error.code === code;
  }
  return isNamedCode(error, 'RouteQuoteError', code);
};
