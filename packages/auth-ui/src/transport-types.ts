import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

import type { AuthUiCredential, AuthUiResult, AuthUiSession } from './types.js';

export interface RequestEmailCodeInput {
  email: string;
}

export interface RequestEmailCodeResult {
  delivery: 'email' | 'magic_link' | string;
  expiresAt?: string;
}

export interface VerifyEmailCodeInput {
  email: string;
  code: string;
}

export interface VerifyEmailCodeResult {
  verificationToken: string;
}

export interface VerifyMagicLinkInput {
  token: string;
}

export interface CreatePasskeyRegistrationOptionsInput {
  email: string;
  verificationToken: string;
  deviceName?: string;
}

export interface CreatePasskeyRegistrationOptionsResult {
  userId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface VerifyPasskeyRegistrationInput {
  email: string;
  verificationToken: string;
  userId: string;
  credential: RegistrationResponseJSON;
  deviceName?: string;
}

export interface CreatePasskeyAuthenticationOptionsInput {
  email?: string;
}

export interface CreatePasskeyAuthenticationOptionsResult {
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface VerifyPasskeyAuthenticationInput {
  credential: AuthenticationResponseJSON;
}

export interface RenameCredentialInput {
  credentialId: string;
  deviceName: string;
}

export interface RevokeCredentialInput {
  credentialId: string;
}

export interface ListCredentialsResult {
  credentials: AuthUiCredential[];
}

export interface ApproveDevicePairingInput {
  userCode: string;
  deviceName?: string;
}

export interface ApproveDevicePairingResult {
  deviceName?: string;
}

export interface AuthUiTransport {
  requestEmailCode(input: RequestEmailCodeInput): Promise<AuthUiResult<RequestEmailCodeResult>>;
  verifyEmailCode(input: VerifyEmailCodeInput): Promise<AuthUiResult<VerifyEmailCodeResult>>;
  verifyMagicLink(input: VerifyMagicLinkInput): Promise<AuthUiResult<AuthUiSession>>;
  createPasskeyRegistrationOptions(
    input: CreatePasskeyRegistrationOptionsInput,
  ): Promise<AuthUiResult<CreatePasskeyRegistrationOptionsResult>>;
  verifyPasskeyRegistration(input: VerifyPasskeyRegistrationInput): Promise<AuthUiResult<AuthUiSession>>;
  createPasskeyAuthenticationOptions(
    input: CreatePasskeyAuthenticationOptionsInput,
  ): Promise<AuthUiResult<CreatePasskeyAuthenticationOptionsResult>>;
  verifyPasskeyAuthentication(input: VerifyPasskeyAuthenticationInput): Promise<AuthUiResult<AuthUiSession>>;
  refreshSession(): Promise<AuthUiResult<AuthUiSession>>;
  logout(): Promise<AuthUiResult<void>>;
  listCredentials(): Promise<AuthUiResult<ListCredentialsResult>>;
  renameCredential(input: RenameCredentialInput): Promise<AuthUiResult<AuthUiCredential>>;
  revokeCredential(input: RevokeCredentialInput): Promise<AuthUiResult<void>>;
  approveDevicePairing(
    input: ApproveDevicePairingInput,
  ): Promise<AuthUiResult<ApproveDevicePairingResult>>;
}
