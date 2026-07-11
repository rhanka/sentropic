// BR-39e Lot 6 (D17) — upstream social/enterprise federation UI contracts.
//
// Pure, framework-agnostic helpers backing the `federationProviders` prop on
// `AuthLogin`/`AuthRegister` and the authenticated link/unlink surface
// (`AuthLinkedIdentities`). Kept free of Svelte so it runs under the package's
// node-environment vitest harness (`make test-auth-ui`).

/**
 * A social/enterprise provider offered on the auth screens. `startHref` points
 * at the IdP federation start route (`GET /auth/federation/:provider/start`);
 * activating it is a **browser redirect**, never an `AuthUiTransport` XHR. The
 * host owns the exact href, so it may carry `?continue=…` (downstream SSO
 * resume) or `?linkTo=…` (authenticated manual-link path, §3.3 step 6).
 */
export interface AuthUiFederationProvider {
  /** Stable provider id (e.g. `'google'`); selects the built-in glyph. */
  id: string;
  /** Human-facing provider name (e.g. `'Google'`). */
  label: string;
  /** Href to the IdP federation start route — a browser redirect, not an XHR. */
  startHref: string;
}

/**
 * A federated identity already linked to the signed-in account, listed on the
 * authenticated settings surface. Fields beyond `id`/`provider` are display-only
 * (`emailAtLink` is audit-only per D13 and never used for re-linking).
 */
export interface AuthUiLinkedIdentity {
  /** Opaque, stable row id (used as the unlink target and list key). */
  id: string;
  /** Provider id (e.g. `'google'`); selects the glyph + falls back as a label. */
  provider: string;
  /** Optional display label; defaults to a titled `provider` when absent. */
  providerLabel?: string;
  /** Provider-asserted email at link time — display only (D13). */
  email?: string | null;
  /** ISO timestamp the identity was linked. */
  linkedAt?: string | null;
  /** ISO timestamp of the last successful login through this identity. */
  lastLoginAt?: string | null;
}

/**
 * The other sign-in factors an account holds, used to reflect the server-side
 * last-factor lockout guard (D12) in the UI. Passkeys + a magic-link-capable
 * email both count as factors alongside linked identities.
 */
export interface SignInFactorContext {
  /** All linked identities currently on the account. */
  identities: AuthUiLinkedIdentity[];
  /** Count of registered passkeys (WebAuthn credentials). Default 0. */
  credentialCount?: number;
  /** Whether the account can still sign in via a magic link. Default false. */
  magicLinkCapable?: boolean;
}

/** Provider ids that ship a built-in glyph; anything else renders a text mark. */
export const KNOWN_FEDERATION_PROVIDER_IDS = [
  'google',
  'github',
  'microsoft',
  'apple',
  'facebook',
] as const;

export type KnownFederationProviderId = (typeof KNOWN_FEDERATION_PROVIDER_IDS)[number];

/** Normalize an arbitrary provider id to a known glyph key, else `'generic'`. */
export const resolveFederationGlyphId = (
  id: string,
): KnownFederationProviderId | 'generic' => {
  const normalized = id.trim().toLowerCase();
  return (KNOWN_FEDERATION_PROVIDER_IDS as readonly string[]).includes(normalized)
    ? (normalized as KnownFederationProviderId)
    : 'generic';
};

/** Fill a `{label}` placeholder in a button copy template (e.g. "Continue with {label}"). */
export const formatFederationLabel = (template: string, label: string): string =>
  template.replace(/\{label\}/g, label);

/** Display label for a linked identity: explicit `providerLabel`, else a titled provider id. */
export const federationIdentityLabel = (identity: AuthUiLinkedIdentity): string => {
  if (identity.providerLabel && identity.providerLabel.trim()) {
    return identity.providerLabel;
  }
  const provider = identity.provider ?? '';
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : provider;
};

/**
 * Client-side reflection of the D12 lockout guard: returns `true` when
 * unlinking `target` would remove the account's **last** sign-in factor.
 * Remaining factors = other linked identities + passkeys + magic-link capability.
 * The server independently enforces this (Lot 0); the UI only mirrors it.
 */
export const isLastSignInFactor = (
  target: AuthUiLinkedIdentity,
  context: SignInFactorContext,
): boolean => {
  const remainingIdentities = context.identities.filter(
    (identity) => identity.id !== target.id,
  ).length;
  const passkeys = Math.max(0, context.credentialCount ?? 0);
  const magicLink = context.magicLinkCapable ? 1 : 0;
  return remainingIdentities + passkeys + magicLink === 0;
};
