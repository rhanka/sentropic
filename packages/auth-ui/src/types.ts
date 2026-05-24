export type AuthUiErrorCode =
  | 'invalid_input'
  | 'transport_error'
  | 'email_code_invalid'
  | 'magic_link_invalid'
  | 'passkey_cancelled'
  | 'passkey_already_registered'
  | 'passkey_no_matching_authenticator'
  | 'passkey_not_supported'
  | 'passkey_registration_failed'
  | 'passkey_authentication_failed'
  | 'credential_not_found'
  | 'unknown';

export interface AuthUiError extends Error {
  readonly name: 'AuthUiError';
  readonly code: AuthUiErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export type AuthUiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthUiError };

export interface AuthUiUser {
  id: string;
  email: string;
  displayName?: string | null;
  role?: string | null;
}

export interface AuthUiSession {
  user: AuthUiUser;
  sessionToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface AuthUiCredential {
  id: string;
  credentialId: string;
  deviceName: string;
  uv: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuthUiNavigation {
  navigate(to: string): void | Promise<void>;
  buildLoginHref?(returnUrl?: string): string;
  buildRegisterHref?(returnUrl?: string): string;
  buildDevicesHref?(): string;
}

export interface AuthUiSessionCallbacks {
  onSession?(session: AuthUiSession): void | Promise<void>;
  onLogout?(): void | Promise<void>;
  onError?(error: AuthUiError): void | Promise<void>;
}

export interface AuthUiBranding {
  productName?: string;
  logoUrl?: string;
  logoAlt?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface AuthUiLabels {
  loginTitle: string;
  loginSupportedHint: string;
  loginUnavailable: string;
  loginButton: string;
  loginButtonLoading: string;
  loginLostDevice: string;
  loginRegisterNewDevice: string;
  loginBackToLogin: string;
  registerTitle: string;
  registerSubtitle: string;
  registerEmailLabel: string;
  registerGetCode: string;
  registerSendingCode: string;
  registerCodeLabel: string;
  registerPasskeyButton: string;
  registerSuccess: string;
  magicLinkTitle: string;
  magicLinkVerifying: string;
  magicLinkSuccess: string;
  devicesTitle: string;
  devicesSubtitle: string;
  devicesEmpty: string;
  devicesRename: string;
  devicesRevoke: string;
  devicesAddNew: string;
  passkeyNotSupported: string;
  passkeyCancelled: string;
  passkeyAlreadyRegistered: string;
  passkeyNoMatchingAuthenticator: string;
  passkeyAuthenticatorNotSupported: string;
}
