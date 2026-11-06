import type {
  AuthHonoPorts, AuthHonoUserRecord, AuthHonoAccountPolicyPort, AuthHonoRelyingPartyConfig,
  AuthHonoWebAuthnRegistrationService, AuthHonoWebAuthnAuthenticationService, AuthHonoMagicLinkService,
  AuthHonoSessionService, AuthHonoEmailVerificationService, FederationResolveInput, FederationResolveOutcome,
  AuthHonoRequestMagicLinkResult, AuthHonoRequestEmailCodeResult, AuthHonoVerifyRegistrationResult,
  AuthHonoVerifyAuthenticationResult, AuthHonoVerifyMagicLinkResult, AuthHonoVerifyEmailCodeResult,
} from '@sentropic/auth-hono';
import type { IdentityTransactionV1, IdentityDigestPortV1, IdentityLoginTokenPortV1, IdentityEmailTicketTokenPortV1, IdentityEmailCodeKeyRingV1 } from './custody.js';
import type { ServiceTenantEnrollmentSourceV1 } from './service-tenancy.js';

export type IdentityDeferredMailV1 =
  | { readonly kind: 'code'; readonly email: string; readonly code: string; readonly expiresAt: string }
  | { readonly kind: 'magic_link'; readonly email: string; readonly token: string; readonly expiresAt: string; readonly url: string };
export type IdentityAuthAccountPolicyV1 = Pick<AuthHonoAccountPolicyPort, 'normalizeEmail' | 'deriveDisplayName' | 'resolveUserVerification' | 'roleForNewUser' | 'statusForNewUser'>;
export interface IdentityAuthBusinessHooksV1<H> {
  afterUserCreated(user: AuthHonoUserRecord, tx: IdentityTransactionV1<H>): Promise<void>;
  provisionWorkspace(userId: string, tx: IdentityTransactionV1<H>): Promise<void>;
}
export type IdentityAuthCompletionFlowV1 = 'registration' | 'authentication' | 'magic_link' | 'email_code'
  | 'magic_link_issue' | 'email_code_issue' | 'session_validate' | 'session_refresh' | 'social'
  | 'credential_rename' | 'credential_revoke' | 'social_unlink';
export type IdentityAuthRefusalV1 =
  | { readonly flow: 'magic_link_issue'; readonly result: Extract<AuthHonoRequestMagicLinkResult, { success: false }> }
  | { readonly flow: 'email_code_issue'; readonly result: Extract<AuthHonoRequestEmailCodeResult, { success: false }> }
  | { readonly flow: 'registration'; readonly result: Extract<AuthHonoVerifyRegistrationResult, { verified: false }> }
  | { readonly flow: 'authentication'; readonly result: Extract<AuthHonoVerifyAuthenticationResult, { verified: false }> }
  | { readonly flow: 'magic_link'; readonly result: Extract<AuthHonoVerifyMagicLinkResult, { valid: false }> }
  | { readonly flow: 'email_code'; readonly result: Extract<AuthHonoVerifyEmailCodeResult, { valid: false }> }
  | { readonly flow: 'session_validate' | 'session_refresh' | 'credential_rename'; readonly result: null }
  | { readonly flow: 'credential_revoke' | 'social_unlink'; readonly result: false };
export type IdentityAuthCompletionOutcomeV1<T> = { readonly committed: true; readonly value: T } | { readonly committed: false; readonly refusal: IdentityAuthRefusalV1 };
export interface IdentityAuthHonoTransactionBindingV1 {
  readonly ports: AuthHonoPorts;
  readonly registration: AuthHonoWebAuthnRegistrationService;
  readonly authentication: AuthHonoWebAuthnAuthenticationService;
  readonly magicLink: AuthHonoMagicLinkService;
  resolveFederatedUser(input: FederationResolveInput): Promise<FederationResolveOutcome>;
  readonly sessions: AuthHonoSessionService;
  readonly emailVerification: AuthHonoEmailVerificationService;
  readonly deferredMail: readonly IdentityDeferredMailV1[];
  flushAudit(): Promise<void>;
}

/** Factory input shared only by the implementation modules. */
export interface IdentityAuthBindingInput<H> {
  readonly tx: IdentityTransactionV1<H>; readonly hostPorts: AuthHonoPorts;
  readonly digest: IdentityDigestPortV1; readonly loginTokens: IdentityLoginTokenPortV1;
  readonly ticketTokens: IdentityEmailTicketTokenPortV1; readonly emailCodeKeys: IdentityEmailCodeKeyRingV1;
  readonly rp: AuthHonoRelyingPartyConfig; readonly accountPolicy: IdentityAuthAccountPolicyV1;
  /**
   * Optional per-flow ceremony timeouts in milliseconds. When present, both the
   * client-facing `timeout` and the server-side challenge TTL derive from the
   * same value so the stored proof never outlives the ceremony the user sees.
   * When absent, the auth service defaults apply.
   */
  readonly webAuthnPolicy: { readonly registrationUserVerification: 'required' | 'preferred' | 'discouraged'; readonly authenticationUserVerification: 'required' | 'preferred' | 'discouraged';
    readonly registrationTimeoutMs?: number; readonly authenticationTimeoutMs?: number };
  readonly magicLink: { readonly baseUrl: string; readonly tokenBytes: number; readonly ttlSeconds: number };
  readonly social: { readonly autoLinkProviders: readonly string[] };
  readonly business: IdentityAuthBusinessHooksV1<H>;
  readonly trustedRegistration: { readonly email: string; readonly clientId: string | null } | null;
  /**
   * P3 (lot G3): CM-owned service-principal tenancy. When present, the binding
   * builds `ports.serviceTenant` itself from the issuer over `tx.stores`;
   * setting it together with `hostPorts.serviceTenant` is refused at
   * construction. When absent, the host port passes through unchanged.
   */
  readonly serviceTenancy?: { readonly enrollments?: ServiceTenantEnrollmentSourceV1 };
}
