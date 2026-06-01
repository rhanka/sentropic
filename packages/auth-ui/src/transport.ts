import { createAuthUiError } from './errors.js';
import type { AuthUiTransport } from './transport-types.js';

export const assertAuthUiTransport = (candidate: unknown): AuthUiTransport => {
  const requiredMethods: Array<keyof AuthUiTransport> = [
    'requestEmailCode',
    'verifyEmailCode',
    'verifyMagicLink',
    'createPasskeyRegistrationOptions',
    'verifyPasskeyRegistration',
    'createPasskeyAuthenticationOptions',
    'verifyPasskeyAuthentication',
    'refreshSession',
    'logout',
    'listCredentials',
    'renameCredential',
    'revokeCredential',
    'approveDevicePairing',
  ];

  if (!candidate || typeof candidate !== 'object') {
    throw createAuthUiError('invalid_input', 'Auth UI transport must be an object');
  }

  const record = candidate as Record<string, unknown>;
  for (const method of requiredMethods) {
    if (typeof record[method] !== 'function') {
      throw createAuthUiError('invalid_input', `Auth UI transport is missing method ${method}`);
    }
  }

  return candidate as AuthUiTransport;
};
