import type {
  AuthHonoAccountPolicyPort,
  AuthHonoAuditLogPort,
  AuthHonoClockPort,
  AuthHonoDeviceInfo,
  AuthHonoFederationPort,
  AuthHonoSessionTokens,
  AuthHonoUserPort,
  AuthHonoUserRecord,
} from '@sentropic/auth-hono';

/**
 * BR-39e Lot 1 — federation broker types.
 *
 * A `FederationProvider` is the ONLY provider-library-aware seam: it builds the upstream
 * authorization URL and, on callback, exchanges the code and returns a VERIFIED identity
 * ({subject, email, emailVerified}) — never the raw external tokens. The broker (broker.ts)
 * is provider-agnostic and holds all security invariants (D1/D5/D10/D11); providers plug in
 * behind this interface so the callback logic, flow-state, linking and session mint stay ours.
 */

/** The verified identity a provider extracts from the upstream callback. NEVER carries tokens (D1). */
export interface FederationProviderIdentity {
  /** Stable upstream subject (Google `sub`) — the single linking key (D6), NOT the email. */
  subject: string;
  /** Provider-asserted email (may be null for providers that omit it). */
  email: string | null;
  /** Whether the provider asserted the email verified. */
  emailVerified: boolean;
  /** MS `tid` (null for Google); audit + future subject policy. */
  providerTenant?: string | null;
}

export interface FederationProvider {
  /** Provider id (e.g. 'google') — the `identities.provider` value + auto-link allowlist key. */
  readonly id: string;
  /** Build the upstream authorization URL carrying ONLY state + nonce + PKCE challenge (never the continuation). */
  createAuthorizationUrl(input: {
    state: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<string> | string;
  /**
   * Exchange the code and return the VERIFIED identity. Throws on any exchange /
   * id_token signature / issuer / audience / nonce failure — the broker maps a throw to a reject.
   * The external access/id tokens are used server-side inside this call only, then dropped (D1).
   */
  verifyCallback(input: {
    code: string;
    codeVerifier: string | null;
    nonce: string | null;
  }): Promise<FederationProviderIdentity>;
}

/** Random-secret generators for the per-start state + nonce + PKCE verifier (D10). */
export interface FederationBrokerSecrets {
  state(): string;
  nonce(): string;
  codeVerifier(): string;
}

export interface FederationBrokerConfig {
  /** D8 auto-link allowlist (Google only in v1). */
  autoLinkProviders: ReadonlySet<string>;
  /** One-time flow-state TTL. */
  flowStateTtlSeconds: number;
  /** Downstream resume target — the OAuth authorize endpoint (`?continue=` appended, D11). */
  authorizeUrl: string;
  /** Fixed internal landing when there is no continuation (D11) — never a caller-supplied returnTo. */
  landingUrl: string;
}

export interface FederationBrokerDeps {
  provider: FederationProvider;
  federation: AuthHonoFederationPort;
  users: Pick<AuthHonoUserPort, 'create' | 'findByEmail' | 'findById'>;
  accountPolicy: Pick<
    AuthHonoAccountPolicyPort,
    'deriveDisplayName' | 'normalizeEmail' | 'resolveSessionRole' | 'roleForNewUser' | 'statusForNewUser'
  >;
  provisionWorkspace: (userId: string) => Promise<void>;
  /** Mint a FRESH Sentropic session (session rotation / anti-fixation, D10). */
  mintSession: (input: {
    user: AuthHonoUserRecord;
    deviceInfo?: AuthHonoDeviceInfo;
  }) => Promise<AuthHonoSessionTokens>;
  audit: AuthHonoAuditLogPort;
  clock: AuthHonoClockPort;
  secrets: FederationBrokerSecrets;
  config: FederationBrokerConfig;
  isFirstUser?: () => Promise<boolean> | boolean;
}

export interface FederationStartRequest {
  /** The sealed OAuth `?continue=` continuation (stored server-side as a pointer; NEVER sent upstream, D5). */
  continuation: string | null;
  deviceInfo?: AuthHonoDeviceInfo;
}

export interface FederationCallbackRequest {
  /** The opaque flow-state id read from the bound cookie (D5). */
  flowStateId: string | null;
  /** Upstream CSRF `state` echoed by the provider. */
  state: string | null;
  /** Upstream authorization `code`. */
  code: string | null;
  /** Upstream `error` (user denied / provider failure). */
  error: string | null;
  deviceInfo?: AuthHonoDeviceInfo;
}

export interface FederationErrorBody {
  error: { code: string; message: string };
}

export type FederationStartResult =
  | { kind: 'redirect'; location: string; flowStateId: string; expiresAt: Date }
  | { kind: 'error'; status: number; body: FederationErrorBody };

export type FederationCallbackResult =
  | { kind: 'authenticated'; location: string; session: AuthHonoSessionTokens }
  | { kind: 'error'; status: number; body: FederationErrorBody; clearFlowCookie: boolean };

export interface FederationBroker {
  start(request: FederationStartRequest): Promise<FederationStartResult>;
  callback(request: FederationCallbackRequest): Promise<FederationCallbackResult>;
}
