import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiLabels,
  AuthUiSession,
  AuthUiTransport,
} from '../contracts.js';

export interface AuthLoginProps {
  transport: AuthUiTransport;
  labels?: Partial<AuthUiLabels>;
  onLoggedIn: (session: AuthUiSession) => void | Promise<void>;
  onLostDevice?: () => void;
  onError?: (error: AuthUiError) => void;
  /**
   * BR-39r L4 — OIDC `login_hint`: optional email hint forwarded to the authentication-options
   * request so the IdP can scope the passkey challenge to a known user (advisory; discoverable login
   * still works). Mirrors the `presetEmail` prop in `AuthLogin.svelte`.
   */
  presetEmail?: string;
}

declare const AuthLogin: Component<AuthLoginProps>;
export default AuthLogin;
