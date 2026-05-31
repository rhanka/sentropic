import { startAuthentication as defaultStartAuthentication, startRegistration as defaultStartRegistration } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

import { createAuthUiError, createDefaultAuthUiLabels, type AuthUiError, type AuthUiLabels } from './contracts.js';

export interface AuthUiWebAuthnBrowser {
  PublicKeyCredential?: {
    new (...args: never[]): unknown;
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  };
}

export interface StartPasskeyRegistrationOptions {
  browser?: AuthUiWebAuthnBrowser;
  startRegistration?: (input: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }) => Promise<RegistrationResponseJSON>;
}

export interface StartPasskeyAuthenticationOptions {
  browser?: AuthUiWebAuthnBrowser;
  startAuthentication?: (input: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) => Promise<AuthenticationResponseJSON>;
}

const getDefaultBrowser = (): AuthUiWebAuthnBrowser | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as AuthUiWebAuthnBrowser);

export const isWebAuthnSupported = (browser: AuthUiWebAuthnBrowser | undefined = getDefaultBrowser()): boolean =>
  typeof browser?.PublicKeyCredential === 'function';

export const isPlatformAuthenticatorAvailable = async (
  browser: AuthUiWebAuthnBrowser | undefined = getDefaultBrowser(),
): Promise<boolean> => {
  if (!isWebAuthnSupported(browser)) {
    return false;
  }

  try {
    return Boolean(await browser?.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
};

export const startPasskeyRegistration = async (
  options: PublicKeyCredentialCreationOptionsJSON,
  deps: StartPasskeyRegistrationOptions = {},
): Promise<RegistrationResponseJSON> => {
  if (!isWebAuthnSupported(deps.browser)) {
    throw createAuthUiError('passkey_not_supported', 'WebAuthn is not supported in this browser');
  }

  try {
    return await (deps.startRegistration ?? defaultStartRegistration)({ optionsJSON: options });
  } catch (error) {
    throw mapWebAuthnError(error, 'registration');
  }
};

export const startPasskeyAuthentication = async (
  options: PublicKeyCredentialRequestOptionsJSON,
  deps: StartPasskeyAuthenticationOptions = {},
): Promise<AuthenticationResponseJSON> => {
  if (!isWebAuthnSupported(deps.browser)) {
    throw createAuthUiError('passkey_not_supported', 'WebAuthn is not supported in this browser');
  }

  try {
    return await (deps.startAuthentication ?? defaultStartAuthentication)({ optionsJSON: options });
  } catch (error) {
    throw mapWebAuthnError(error, 'authentication');
  }
};

export const getWebAuthnErrorMessage = (
  error: unknown,
  labels: Partial<AuthUiLabels> = createDefaultAuthUiLabels(),
): string => {
  if (typeof error === 'string') {
    return error;
  }

  const code = (error as Partial<AuthUiError> | undefined)?.code;
  const message = (error as { message?: string } | undefined)?.message ?? 'Unknown error';

  switch (code) {
    case 'passkey_cancelled':
      return labels.passkeyCancelled ?? message;
    case 'passkey_already_registered':
      return labels.passkeyAlreadyRegistered ?? message;
    case 'passkey_no_matching_authenticator':
      return labels.passkeyNoMatchingAuthenticator ?? message;
    case 'passkey_not_supported':
      return labels.passkeyNotSupported ?? message;
    default:
      return message;
  }
};

const mapWebAuthnError = (error: unknown, ceremony: 'registration' | 'authentication'): AuthUiError => {
  const name = (error as { name?: string } | undefined)?.name;
  const message = (error as { message?: string } | undefined)?.message ?? 'Unknown error';

  if (name === 'NotAllowedError') {
    return createAuthUiError(
      'passkey_cancelled',
      ceremony === 'registration' ? 'Registration cancelled by user' : 'Authentication cancelled by user',
      { retryable: true, cause: error },
    );
  }

  if (name === 'InvalidStateError') {
    const code = ceremony === 'registration' ? 'passkey_already_registered' : 'passkey_no_matching_authenticator';
    const fallback = ceremony === 'registration' ? 'This authenticator is already registered' : 'No matching authenticator found';
    return createAuthUiError(code, fallback, { retryable: ceremony !== 'registration', cause: error });
  }

  if (name === 'NotSupportedError') {
    return createAuthUiError('passkey_not_supported', 'This authenticator is not supported', {
      retryable: false,
      cause: error,
    });
  }

  return createAuthUiError(
    ceremony === 'registration' ? 'passkey_registration_failed' : 'passkey_authentication_failed',
    `${ceremony === 'registration' ? 'Registration' : 'Authentication'} failed: ${message}`,
    { retryable: true, cause: error },
  );
};
