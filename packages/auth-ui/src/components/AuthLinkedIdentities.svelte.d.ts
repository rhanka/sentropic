import type { Component } from 'svelte';
import type {
  AuthUiError,
  AuthUiFederationProvider,
  AuthUiLabels,
  AuthUiLinkedIdentity,
} from '../contracts.js';

export interface AuthLinkedIdentitiesProps {
  /** Linked identities to display. */
  identities?: AuthUiLinkedIdentity[];
  /** Registered passkey count — a sign-in factor for the last-factor guard. Default 0. */
  credentialCount?: number;
  /** Whether the account can still sign in via magic link. Default false. */
  magicLinkCapable?: boolean;
  /** Providers offered to link a new identity (buttons redirect to their `startHref`). */
  federationProviders?: AuthUiFederationProvider[];
  labels?: Partial<AuthUiLabels>;
  /** Host-controlled date formatter; defaults to ISO date (yyyy-mm-dd). */
  formatDate?: (iso: string) => string;
  /** Async confirmation hook so hosts can render a modal instead of `window.confirm`. */
  confirmUnlink?: (message: string) => boolean | Promise<boolean>;
  /** Host performs the unlink call and reloads the list. */
  onUnlink?: (identity: AuthUiLinkedIdentity) => void | Promise<void>;
  onError?: (error: AuthUiError) => void;
}

declare const AuthLinkedIdentities: Component<AuthLinkedIdentitiesProps>;
export default AuthLinkedIdentities;
