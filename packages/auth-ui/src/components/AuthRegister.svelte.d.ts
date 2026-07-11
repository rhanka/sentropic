import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiFederationProvider,
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
  /**
   * BR-39e Lot 6 (D17) — optional social/enterprise providers rendered as
   * DS-styled redirect buttons on the initial email step. Empty/absent → no
   * federation UI (legacy hosts unaffected).
   */
  federationProviders?: AuthUiFederationProvider[];
}

declare const AuthRegister: Component<AuthRegisterProps>;
export default AuthRegister;
