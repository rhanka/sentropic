import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiSession,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthRegisterProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  onRegistered: (session: AuthUiSession) => void | Promise<void>;
  onError?: (error: AuthUiError) => void;
  /**
   * When true, the component skips the email + code steps and renders only
   * the WebAuthn step. Requires `presetEmail` and `presetVerificationToken`.
   */
  skipEmailVerification?: boolean;
  presetEmail?: string;
  presetVerificationToken?: string;
  deviceName?: string;
}

declare const AuthRegister: Component<AuthRegisterProps>;
export default AuthRegister;
