import type { Component } from 'svelte';
import type {
  AuthUiError,
  OAuthConsentDetails,
  OAuthConsentLabels,
  OAuthConsentTransport,
} from '../contracts.js';

export interface OAuthConsentProps {
  decisionAction?: string;
  initialDetails?: OAuthConsentDetails;
  labels?: Partial<OAuthConsentLabels>;
  onError?: (error: AuthUiError) => void;
  onRedirect?: (url: string) => void;
  state: string;
  transport: OAuthConsentTransport;
}

declare const OAuthConsent: Component<OAuthConsentProps>;
export default OAuthConsent;
