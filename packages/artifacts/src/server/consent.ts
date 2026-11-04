/**
 * Lot 1a — persistent reader consent, pure evaluation (design-merged §3.1,
 * §3.2). A consent row authorizes one data class at one scope version; it
 * never substitutes fresh rights. Validity is live row plus current scope
 * version plus fresh rights, evaluated per call. No release, session, device
 * or TTL column exists: the row outlives sessions and releases until revoked.
 */

export interface ConsentKey {
  storageScopeId: string;
  readerAccountId: string;
  artifactId: string;
  scopeId: string;
  scopeVersion: string;
}

export interface ReaderConsentRecord extends ConsentKey {
  /** UUID, one row per grant episode; re-grant after revoke mints a new row. */
  consentId: string;
  /** ISO-8601 text, aligned with cluster-mesh consent records. */
  grantedAt: string;
  /** Lot 1a: a first-party gesture on the control-origin screen mints consent; the model never grants. */
  grantedVia: 'reader_screen';
  revokedAt?: string;
  revokedBy?: 'self' | 'admin' | 'cascade';
}

export interface ReaderConsentEvent {
  consentId: string;
  storageScopeId: string;
  readerAccountId: string;
  artifactId: string;
  scopeId: string;
  scopeVersion: string;
  action: 'grant' | 'revoke';
  actor: string;
  surface: 'screen' | 'api' | 'mcp' | 'cascade';
  at: string;
}

/** Host-declared scope ids are package-opaque: letter start, dots/dashes/underscores, at most 128. */
const SCOPE_ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
/** Scope versions are host content; widening bumps them, narrowing keeps them (§3.1). */
const SCOPE_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function assertConsentScopeId(scopeId: string): void {
  if (!SCOPE_ID_PATTERN.test(scopeId) || scopeId.startsWith('sentropic:')) {
    throw new Error(`invalid consent scope id: ${scopeId}`);
  }
}

export function assertConsentScopeVersion(scopeVersion: string): void {
  if (!SCOPE_VERSION_PATTERN.test(scopeVersion)) throw new Error(`invalid consent scope version: ${scopeVersion}`);
}

/** Live row at the host's current scope version; absence of TTL is the owner requirement. */
export function consentAllows(
  record: ReaderConsentRecord | undefined,
  currentScopeVersion: string,
): record is ReaderConsentRecord {
  return record !== undefined && record.revokedAt === undefined && record.scopeVersion === currentScopeVersion;
}

/** Fresh-rights input of Gate B: approved account plus ACL read, re-evaluated on this call. */
export type FreshRights = 'ok' | 'suspended' | 'withdrawn' | 'gone';

export type GateBDecision =
  | { allowed: true }
  | { allowed: false; refusal: 'reader_consent_required'; scopeId: string }
  | { allowed: false; refusal: 'refused'; status: 401 | 404 };

/**
 * Gate B (§3.2): the business call executes only with a live consent at the
 * current scope version AND fresh rights. A suspended account or a withdrawn
 * share is refused with the row kept dormant, so reactivation or re-share
 * resumes without a screen. A non-reader never sees the consent page.
 */
export function decideGateB(input: {
  consent: ReaderConsentRecord | undefined;
  currentScopeVersion: string;
  rights: FreshRights;
  scopeId: string;
}): GateBDecision {
  if (input.rights === 'gone') return { allowed: false, refusal: 'refused', status: 404 };
  if (input.rights === 'suspended') return { allowed: false, refusal: 'refused', status: 401 };
  if (input.rights === 'withdrawn') return { allowed: false, refusal: 'refused', status: 404 };
  if (!consentAllows(input.consent, input.currentScopeVersion)) {
    return { allowed: false, refusal: 'reader_consent_required', scopeId: input.scopeId };
  }
  return { allowed: true };
}
