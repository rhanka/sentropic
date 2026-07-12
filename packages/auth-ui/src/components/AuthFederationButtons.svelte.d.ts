import type { Component } from 'svelte';
import type { AuthUiFederationProvider, AuthUiLabels } from '../contracts.js';

export interface AuthFederationButtonsProps {
  /** Providers to offer. Empty/absent → renders nothing (legacy-safe). */
  providers?: AuthUiFederationProvider[];
  labels?: Partial<AuthUiLabels>;
  /** Show the "or" divider above the buttons. Default true. */
  showDivider?: boolean;
  /**
   * Per-button copy template with a `{label}` placeholder. Defaults to
   * `labels.federationContinueWith` ("Continue with {label}").
   */
  labelTemplate?: string;
  /** Navigation hook; defaults to a full-page `window.location.assign` redirect. */
  onNavigate?: (href: string) => void;
}

declare const AuthFederationButtons: Component<AuthFederationButtonsProps>;
export default AuthFederationButtons;
