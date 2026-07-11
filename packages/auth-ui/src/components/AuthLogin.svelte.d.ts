import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiFederationProvider,
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
  /**
   * BR-39e Lot 6 (D17) — optional social/enterprise providers rendered as DS-styled redirect
   * buttons below the passkey login. Empty/absent → no federation UI (legacy hosts unaffected).
   */
  federationProviders?: AuthUiFederationProvider[];
}

declare const AuthLogin: Component<AuthLoginProps>;
export default AuthLogin;
