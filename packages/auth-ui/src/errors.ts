import type { AuthUiError, AuthUiErrorCode } from './types.js';

export const createAuthUiError = (
  code: AuthUiErrorCode,
  message: string,
  options: { retryable?: boolean; cause?: unknown } = {},
): AuthUiError => {
  const error = new Error(message) as AuthUiError;
  Object.defineProperties(error, {
    name: { value: 'AuthUiError', enumerable: true },
    code: { value: code, enumerable: true },
    retryable: { value: options.retryable ?? false, enumerable: true },
    cause: { value: options.cause, enumerable: false },
  });
  return error;
};

export const normalizeAuthEmail = (email: string): string => email.trim().toLowerCase();
