import type { Component } from 'svelte';
import type {
  AuthUiError,
  OAuthConsentLabels,
  OAuthConsentTransport,
} from '../contracts.js';

export interface OAuthConsentProps {
  labels?: Partial<OAuthConsentLabels>;
  onError?: (error: AuthUiError) => void;
  onRedirect?: (url: string) => void;
  state: string;
  transport: OAuthConsentTransport;
}

declare const OAuthConsent: Component<OAuthConsentProps>;
export default OAuthConsent;
