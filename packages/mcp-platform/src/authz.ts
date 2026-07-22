/**
 * Slice 2 — Per-request authorization middleware (stub).
 *
 * Enforces, on EVERY request (never only at session level — §6, §8):
 * - audience-bound token verification (issuer/audience/expiry/revocation, §6.6);
 * - principal + tenant derived FROM THE TOKEN ONLY — tool/model-supplied ids are
 *   selector hints, never authoritative (§4.4, §6.2);
 * - per-capability scope check → `insufficient_scope` scope step-up (§6.5);
 * - per-capability freshness (`auth_time` vs `max_age`/acr/amr) → auth step-up (§6.5);
 * - tenant cross-check: spoofed / conflicting tenant hints fail closed (§11);
 * - consent state: revoked/missing consent denies (§6, §6.3).
 *
 * MOCK-ONLY: deterministic, in-memory resolvers; no network, no DB.
 */
import type { AuthFreshnessPolicy, AppCapability, ConnectorTenantContext } from './manifest.js';
import type { ConnectorEnrollment, ConsentGrant, LifecycleState } from './runtime.js';
import type { MockTokenClaims, VerifyFailure, VerifyResult } from './mock/oidc.js';
import {
  PersistentConsentStore,
  PersistentEnrollmentStore,
  type ConsentStore,
  type EnrollmentStore,
} from './stores.js';

export type AuthzDenyReason =
  | 'invalid_token'
  | 'missing_capability'
  | 'insufficient_scope'
  | 'missing_claims'
  | 'stale_auth'
  | 'no_enrollment'
  | 'cross_tenant'
  | 'ambiguous_tenant'
  | 'no_consent'
  | 'consent_revoked';

export type AuthzResult =
  | {
      allowed: true;
      principal: {
        sub: string;
        scopes: string[];
        tenantRef: string;
        authTime: string;
        claims: Record<string, unknown>;
      };
      tenantContext: ConnectorTenantContext;
      capability: AppCapability;
    }
  | {
      allowed: false;
      reason: AuthzDenyReason;
      tokenFailure?: VerifyFailure;
      stepUp?: 'auth' | 'scope';
      wwwAuthenticate?: string;
    };

// Hint keys that assert a TENANT identity and must match the token's tid.
const TENANT_HINT_KEYS = ['tenantId', 'tid', 'tenant', 'orgId', 'workspaceId', 'businessId'];

export interface TenantResolver {
  authorizedTenants(principalSub: string, connectorInstanceId: string): Promise<string[]>;
  // Map a domain id hint (e.g. businessId) to its owning tenant, if known.
  tenantOfDomainHint?(key: string, value: string): Promise<string | undefined>;
}

export interface ConsentResolver {
  consentState(
    principalSub: string,
    tenantRef: string,
    connectorInstanceId: string,
    requiredScopes: string[],
  ): 'active' | 'revoked' | 'missing';
}

export type AuthorizeDeps = {
  issuer: { verify(token: string, opts: { expectedAudience: string; expectedIssuer: string; now?: number }): VerifyResult };
  resourceAudience: string;
  expectedIssuer: string;
  capabilities: Map<string, AppCapability>;
  tenantResolver: TenantResolver;
  consentResolver: ConsentResolver;
  manifestFreshness?: AuthFreshnessPolicy;
};

export type AuthzRequest = {
  token: string;
  capabilityRef: string;
  connectorInstanceId: string;
  selectorHints?: Record<string, unknown>; // model/tool-supplied ids — advisory only
  now?: number;
};

type TenantOutcome =
  | { ok: true; tenantRef: string }
  | { ok: false; reason: 'no_enrollment' | 'cross_tenant' | 'ambiguous_tenant' };

/**
 * Resolve the authoritative tenant from the TOKEN only. Selector hints are
 * cross-checked: a hint naming a different tenant fails closed (cross_tenant);
 * conflicting hints fail closed (ambiguous_tenant). Hints never establish the
 * tenant.
 *
 * Tenant access is fail-closed (§6 "no default/broad tenant fallback"): the
 * principal MUST be enrolled on this connector for the token's tenant. An empty
 * enrollment set is NOT a wildcard — it denies (`no_enrollment`).
 */
export async function resolveAuthorizedTenant(
  claims: MockTokenClaims,
  hints: Record<string, unknown>,
  deps: { tenantResolver: TenantResolver; connectorInstanceId: string },
): Promise<TenantOutcome> {
  const authoritative = claims.tid;
  if (!authoritative) return { ok: false, reason: 'ambiguous_tenant' };

  const hintLookups = TENANT_HINT_KEYS.flatMap((key) => {
    const raw = hints[key];
    if (typeof raw !== 'string' || raw.length === 0) return [];
    if (key === 'tenantId' || key === 'tid' || key === 'tenant') return [Promise.resolve(raw)];
    const lookup = deps.tenantResolver.tenantOfDomainHint;
    return lookup ? [lookup.call(deps.tenantResolver, key, raw)] : [];
  });
  const [authorized, ...mappedHints] = await Promise.all([
    deps.tenantResolver.authorizedTenants(claims.sub, deps.connectorInstanceId),
    ...hintLookups,
  ]);

  const resolvedHintTenants = new Set(mappedHints.filter((tenant): tenant is string => Boolean(tenant)));
  if (resolvedHintTenants.size > 1) return { ok: false, reason: 'ambiguous_tenant' };
  for (const hintTenant of resolvedHintTenants) {
    if (hintTenant !== authoritative) return { ok: false, reason: 'cross_tenant' };
  }

  // Fail-closed: an unenrolled principal (empty set) is denied, never broadly
  // accepted. Enrollment that does not cover the token tenant is cross-tenant.
  if (authorized.length === 0) return { ok: false, reason: 'no_enrollment' };
  if (!authorized.includes(authoritative)) return { ok: false, reason: 'cross_tenant' };
  return { ok: true, tenantRef: authoritative };
}

function freshnessDeny(
  claims: MockTokenClaims,
  policy: AuthFreshnessPolicy,
  nowSec: number,
): boolean {
  if (nowSec - claims.auth_time > policy.maxAgeSeconds) return true;
  if (policy.acr?.length && (!claims.acr || !policy.acr.includes(claims.acr))) return true;
  if (policy.amr?.length && !policy.amr.some((m) => claims.amr?.includes(m))) return true;
  return false;
}

/** Authorize a single request. Fail-closed: any failed check denies. */
export async function authorizeRequest(req: AuthzRequest, deps: AuthorizeDeps): Promise<AuthzResult> {
  const v = deps.issuer.verify(req.token, {
    expectedAudience: deps.resourceAudience,
    expectedIssuer: deps.expectedIssuer,
    now: req.now,
  });
  if (!v.valid) {
    const wwwAuthenticate =
      v.reason === 'audience_mismatch'
        ? `Bearer error="invalid_token", error_description="audience mismatch"`
        : undefined;
    return { allowed: false, reason: 'invalid_token', tokenFailure: v.reason, wwwAuthenticate };
  }
  const claims = v.claims;

  // Deny-as-missing: an unknown capability is absent, not "denied" (§7.1).
  const cap = deps.capabilities.get(req.capabilityRef);
  if (!cap) return { allowed: false, reason: 'missing_capability' };

  const scopes = claims.scope.split(' ').filter(Boolean);
  const missingScopes = cap.requiredScopes.filter((s) => !scopes.includes(s));
  if (missingScopes.length > 0) {
    return {
      allowed: false,
      reason: 'insufficient_scope',
      stepUp: 'scope',
      wwwAuthenticate: `Bearer error="insufficient_scope", scope="${cap.requiredScopes.join(' ')}"`,
    };
  }

  // Per-capability required claims (§4.3) enforced fail-closed at invocation: any
  // claim the capability mandates that is absent from the verified token denies.
  const missingClaims = cap.requiredClaims.filter((c) => claims[c] === undefined);
  if (missingClaims.length > 0) {
    return { allowed: false, reason: 'missing_claims', stepUp: 'auth' };
  }

  const policy = cap.freshness ?? deps.manifestFreshness;
  if (policy) {
    const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
    if (freshnessDeny(claims, policy, nowSec)) {
      return {
        allowed: false,
        reason: 'stale_auth',
        stepUp: policy.stepUp === 'scope' ? 'scope' : 'auth',
      };
    }
  }

  const tenant = await resolveAuthorizedTenant(claims, req.selectorHints ?? {}, {
    tenantResolver: deps.tenantResolver,
    connectorInstanceId: req.connectorInstanceId,
  });
  if (!tenant.ok) return { allowed: false, reason: tenant.reason };

  const cs = deps.consentResolver.consentState(
    claims.sub,
    tenant.tenantRef,
    req.connectorInstanceId,
    cap.requiredScopes,
  );
  if (cs === 'revoked') return { allowed: false, reason: 'consent_revoked' };
  if (cs === 'missing') return { allowed: false, reason: 'no_consent' };

  return {
    allowed: true,
    principal: {
      sub: claims.sub,
      scopes,
      tenantRef: tenant.tenantRef,
      authTime: new Date(claims.auth_time * 1000).toISOString(),
      claims: { iss: claims.iss, sub: claims.sub, tid: claims.tid, aud: claims.aud },
    },
    tenantContext: {
      principalRef: claims.sub,
      tenantRef: tenant.tenantRef,
      connectorInstanceId: req.connectorInstanceId,
    },
    capability: cap,
  };
}

// ---------------------------------------------------------------------------
// Record-backed resolvers — deterministic; restart-safe when a durable store
// (FileRecordStore) is injected, else non-durable in-memory (default).
// ---------------------------------------------------------------------------

const isExpired = (expiresAt: string | undefined, now: number): boolean =>
  expiresAt !== undefined && Date.parse(expiresAt) <= now;

/**
 * Enrollment-backed tenant resolver. `authorizedTenants` derives strictly from
 * ACTIVE §6.3 `ConnectorEnrollment` records, so a revoked/expired enrollment is
 * excluded and an unenrolled principal yields an empty set (fail-closed, no broad
 * fallback — fix F1). Domain hints are resolver configuration, not a §6.3 record.
 */
export class InMemoryTenantRegistry implements TenantResolver {
  readonly #enrollments: EnrollmentStore;
  readonly #domainHints = new Map<string, string>(); // 'key:value' -> tenant

  constructor(deps?: { store?: EnrollmentStore }) {
    this.#enrollments = deps?.store ?? new PersistentEnrollmentStore();
  }

  enroll(principalSub: string, connectorInstanceId: string, tenantRef: string): void {
    const e: ConnectorEnrollment = {
      id: connectorInstanceId,
      connectorId: connectorInstanceId,
      principalSub,
      tenantRef,
      state: 'active',
      secretRefs: [],
      createdAt: new Date().toISOString(),
    };
    this.#enrollments.put(e);
  }

  setEnrollmentState(
    principalSub: string,
    connectorInstanceId: string,
    tenantRef: string,
    state: LifecycleState,
  ): void {
    this.#enrollments.setState(principalSub, connectorInstanceId, tenantRef, state);
  }

  mapDomainHint(key: string, value: string, tenantRef: string): void {
    this.#domainHints.set(`${key}:${value}`, tenantRef);
  }

  async authorizedTenants(principalSub: string, connectorInstanceId: string): Promise<string[]> {
    return this.#enrollments
      .forPrincipal(principalSub, connectorInstanceId)
      .filter((e) => e.state === 'active')
      .map((e) => e.tenantRef);
  }

  async tenantOfDomainHint(key: string, value: string): Promise<string | undefined> {
    return this.#domainHints.get(`${key}:${value}`);
  }

  reload(): void {
    this.#enrollments.reload();
  }
}

/**
 * Consent-grant-backed resolver. A grant authorizes only while `state === 'active'`
 * AND unexpired; a missing match denies fail-closed (§6, §6.3). Restart-safe when
 * a durable `ConsentStore` is injected.
 */
export class InMemoryConsentRegistry implements ConsentResolver {
  readonly #grants: ConsentStore;
  readonly #now: () => number;

  constructor(deps?: { store?: ConsentStore; now?: () => number }) {
    this.#grants = deps?.store ?? new PersistentConsentStore();
    this.#now = deps?.now ?? ((): number => Date.now());
  }

  grant(grant: ConsentGrant): void {
    this.#grants.put(grant);
  }

  setState(id: string, state: LifecycleState): void {
    this.#grants.setState(id, state);
  }

  consentState(
    principalSub: string,
    tenantRef: string,
    connectorInstanceId: string,
    requiredScopes: string[],
  ): 'active' | 'revoked' | 'missing' {
    const now = this.#now();
    const matches = this.#grants.all().filter(
      (g) =>
        g.principalSub === principalSub &&
        g.tenantRef === tenantRef &&
        g.connectorInstanceId === connectorInstanceId &&
        requiredScopes.every((s) => g.scopes.includes(s)),
    );
    if (matches.length === 0) return 'missing';
    if (matches.some((g) => g.state === 'active' && !isExpired(g.expiresAt, now))) return 'active';
    return 'revoked';
  }

  reload(): void {
    this.#grants.reload();
  }
}
