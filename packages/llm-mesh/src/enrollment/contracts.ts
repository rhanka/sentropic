// @sentropic/llm-mesh/enrollment/contracts.ts

// Session returned to h2a — h2a opens browser or displays userCode
export type EnrollmentSession =
  | { kind: 'authorization-url'; enrollmentId: string; url: string; expiresAt: string }
  | {
      kind: 'device-code';
      enrollmentId: string;
      verificationUrl: string;
      userCode: string;
      pollIntervalMs: number;
      expiresAt: string;
    };

// State persisted server-side / sentropic-side — NOT exported via facade to h2a
export interface EnrollmentState {
  enrollmentId: string;
  providerId: 'cloud-code' | 'codex' | 'claude-code';
  ownerScope: string;
  pkceVerifier: string;
  pkceState: string;
  redirectUri: string;
  configVersion: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  cancelledAt?: string;
  configRef?: string;
}

export interface StartEnrollmentInput {
  configRef: string;
  mode: 'cli' | 'portal';
  redirectUri: string;
  ownerScope: string;
}

// CompleteEnrollmentInput: internal sentropic use only
export interface CompleteEnrollmentInput {
  enrollmentId: string;
  code: string;
}

export interface PreparedCredential {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  authClientConfigVersion: string;
  accountEmail?: string;
}

// RefreshInput: internal LocalAccountTransportService use only
export interface RefreshInput {
  accountId: string;
  refreshToken?: string;
  credentialVersion: string;
}

export interface ResolvedProviderMetadata {
  cloudaicompanionProject?: string;
  cloudCodeUserAgentVersion?: string;
  [key: string]: unknown;
}

export interface AccountPublic {
  accountId: string;
  accountLabel?: string;
  providerId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialEnvelope {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  authClientConfigVersion: string;
}

export interface CompletedEnrollment {
  accountId: string;
  label: string;
  credential?: PreparedCredential;
  metadata?: ResolvedProviderMetadata;
}

export interface EnrollmentProvider {
  start(input: StartEnrollmentInput): Promise<EnrollmentSession>;
  complete(input: CompleteEnrollmentInput): Promise<PreparedCredential>;
  resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata>;
  refresh(input: RefreshInput): Promise<PreparedCredential>;
  waitForCallback?(enrollmentId: string): Promise<CompletedEnrollment>;
  pollForCompletion?(enrollmentId: string): Promise<CompletedEnrollment>;
  cancel?(enrollmentId: string): Promise<void>;
}
