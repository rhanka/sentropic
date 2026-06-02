export type OAuthConsentDecision = 'approve' | 'deny';

export interface OAuthConsentDetails {
  clientName: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthConsentTransport {
  getConsent(input: { state: string }): Promise<OAuthConsentDetails>;
  submitConsentDecision(input: {
    decision: OAuthConsentDecision;
    state: string;
  }): Promise<{ redirectTo: string }>;
}

export interface OAuthConsentLabels {
  approve: string;
  approving: string;
  deny: string;
  denying: string;
  errorGeneric: string;
  loading: string;
  redirectUriLabel: string;
  scopeDescriptions: Record<string, string>;
  scopesTitle: string;
  title: string;
}
