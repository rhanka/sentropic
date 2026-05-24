import type { AuthUiBranding, AuthUiLabels } from './types.js';

export const createDefaultAuthUiLabels = (overrides: Partial<AuthUiLabels> = {}): AuthUiLabels => ({
  loginTitle: 'Sign in',
  loginSupportedHint: 'Use a passkey to continue.',
  loginUnavailable: 'Passkeys are not available in this browser.',
  loginButton: 'Sign in with passkey',
  loginButtonLoading: 'Signing in...',
  loginLostDevice: 'Lost your device?',
  loginRegisterNewDevice: 'Register a new device',
  loginBackToLogin: 'Back to sign in',
  registerTitle: 'Create an account',
  registerSubtitle: 'Verify your email, then register a passkey.',
  registerEmailLabel: 'Email',
  registerGetCode: 'Get verification code',
  registerSendingCode: 'Sending code...',
  registerCodeLabel: 'Verification code',
  registerPasskeyButton: 'Register passkey',
  registerSuccess: 'Your account is ready.',
  magicLinkTitle: 'Verifying magic link',
  magicLinkVerifying: 'Verifying your link...',
  magicLinkSuccess: 'You are signed in.',
  devicesTitle: 'Passkey devices',
  devicesSubtitle: 'Manage passkeys registered for this account.',
  devicesEmpty: 'No passkey devices are registered.',
  devicesRename: 'Rename',
  devicesRevoke: 'Revoke',
  devicesAddNew: 'Add a passkey',
  passkeyNotSupported: 'WebAuthn is not supported in this browser',
  passkeyCancelled: 'Passkey operation cancelled by user',
  passkeyAlreadyRegistered: 'This authenticator is already registered',
  passkeyNoMatchingAuthenticator: 'No matching authenticator found',
  passkeyAuthenticatorNotSupported: 'This authenticator is not supported',
  ...overrides,
});

export const createDefaultAuthUiBranding = (overrides: Partial<AuthUiBranding> = {}): AuthUiBranding => {
  const branding: AuthUiBranding = {
    primaryColor: '#4f46e5',
    accentColor: '#0f766e',
    ...overrides,
  };

  if (branding.productName && !branding.logoAlt) {
    branding.logoAlt = branding.productName;
  }

  return branding;
};
