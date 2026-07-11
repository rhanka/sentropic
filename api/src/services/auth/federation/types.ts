import type {
  AuthHonoAccountPolicyPort,
  AuthHonoAuditLogPort,
  AuthHonoClockPort,
  AuthHonoDeviceInfo,
  AuthHonoFederationPort,
  AuthHonoIdentityRecord,
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
  /** One-time upstream display name, when supplied (Apple first authorization only). */
  displayName?: string | null;
  /** Private-relay addresses are verified but scoped to their provider. */
  emailScope?: 'global' | 'provider';
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
    profile?: FederationCallbackProfile | null;
  }): Promise<FederationProviderIdentity>;
}

export interface FederationCallbackProfile {
  displayName: string | null;
  email: string | null;
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
  /** Apple `user` form field, present only on the first authorization. */
  profile?: FederationCallbackProfile | null;
  deviceInfo?: AuthHonoDeviceInfo;
}

/**
 * BR-39e Lot 2 — the AUTHENTICATED manual-link callback (D7, §3.3 step 6). This is the ONLY path
 * that attaches a provider to a credentialed account: the already-logged-in user re-proves control
 * of the external account through a FRESH provider round-trip, and the verified identity is bound to
 * that session's user — never a silent merge. `linkUserId` is the authenticated session's user id
 * (null ⇒ unauthenticated ⇒ the broker rejects before any linking, K-MANUAL-LINK-AUTH).
 */
export interface FederationLinkCallbackRequest extends FederationCallbackRequest {
  linkUserId: string | null;
}

/**
 * BR-39e Lot 2 — the email-verification-challenge completion (D9, §3.3 step 4→5). The user has just
 * PROVEN an email locally (magic-link / email code); the pending provider identity — stashed at the
 * challenge (`providerSubject`), NEVER written as a user until now — is resolved with that email
 * treated as verified, so it re-enters the SAFE resolver at the collision step.
 */
export interface FederationEmailChallengeCompletion {
  provider: string;
  providerSubject: string;
  providerTenant?: string | null;
  /** The email the user just proved via the local challenge (treated as provider-verified, D9). */
  verifiedEmail: string;
  /** The sealed OAuth continuation pointer captured at the original callback (D11), or null. */
  continuation: string | null;
  deviceInfo?: AuthHonoDeviceInfo;
}

export interface FederationErrorBody {
  error: { code: string; message: string };
}

/** A ready-to-return rejection shared by the login callback and the authenticated link callback. */
export interface FederationErrorResult {
  kind: 'error';
  status: number;
  body: FederationErrorBody;
  clearFlowCookie: boolean;
}

export type FederationStartResult =
  | { kind: 'redirect'; location: string; flowStateId: string; expiresAt: Date }
  | { kind: 'error'; status: number; body: FederationErrorBody };

export type FederationCallbackResult =
  | { kind: 'authenticated'; location: string; session: AuthHonoSessionTokens }
  /**
   * D9 — the provider gave no usable VERIFIED email; NO user/identity row was written. The route must
   * drive a local email-verification challenge and then call `completeEmailChallenge` with the pending
   * identity carried here (K-GH-NOVERIFIED).
   */
  | {
      kind: 'email-challenge';
      provider: string;
      providerSubject: string;
      providerTenant: string | null;
      /** The sealed OAuth continuation pointer from the flow-state (D11), preserved across the challenge. */
      continuation: string | null;
    }
  | FederationErrorResult;

export type FederationLinkResult =
  | { kind: 'linked'; userId: string; identity: AuthHonoIdentityRecord }
  | FederationErrorResult;

export interface FederationBroker {
  start(request: FederationStartRequest): Promise<FederationStartResult>;
  callback(request: FederationCallbackRequest): Promise<FederationCallbackResult>;
  /**
   * BR-39e Lot 2 — authenticated manual-link callback (D7). Requires `linkUserId`; runs the same
   * state/nonce/PKCE + provider-verify preamble as `callback`, then attaches the verified identity to
   * that user (idempotent if already theirs; rejected if the subject belongs to another account).
   */
  linkCallback(request: FederationLinkCallbackRequest): Promise<FederationLinkResult>;
  /**
   * BR-39e Lot 2 — finish an email-verification challenge (D9). The pending identity re-enters the
   * SAFE resolver with the just-proven email; outcome is a fresh session or a manual-link signal.
   */
  completeEmailChallenge(input: FederationEmailChallengeCompletion): Promise<FederationCallbackResult>;
}
