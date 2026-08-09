/**
 * v0 personal-passthrough CallerAuthPort (spec §2/§7 D0).
 *
 * Personal-passthrough = the caller IS the provider (1 caller = their OWN
 * enrolled accounts, ToS-conforming). So caller-auth here:
 *   1. verifies a SENTROPIC bearer/session token (NOT provider auth);
 *   2. resolves the caller's OWN provider identity (caller == provider);
 *   3. resolves the `CostContext` from the VERIFIED identity, NEVER the body.
 *
 * The actual OIDC/session signature verification (`auth-hono`
 * service-auth-middleware: iss/aud/scope/ath/jti) is an EDGE we stub behind a
 * `VerifyToken` port: production injects the auth-hono verifier; v0 + tests
 * inject a deterministic verifier over fixtures. The FLOW (header parse ->
 * verify -> identity -> CostContext) is real.
 */

import type { CallerAuthPort, CallerAuthResult } from '../ports/caller-auth.js';
import type { CostContext } from '../ports/cost-context.js';

/**
 * The verified SENTROPIC principal. In personal-passthrough this principal is
 * also the provider whose enrolled accounts the pool will select from.
 */
export interface VerifiedPrincipal {
  readonly tenantId: string;
  readonly principalId: string;
  /** Stable account-ownership scope asserted by the trusted verifier. */
  readonly ownerScopeRef?: string;
  readonly workspaceId?: string;
  readonly source: string;
  readonly budgetScope?: string;
}

/**
 * Caller-auth schemes the gateway accepts (spec §3):
 *  - `Bearer`  — `Authorization: Bearer <OIDC/session>` (the canonical path).
 *  - `DPoP`    — `DPoP <token>` + proof for S2S.
 *  - `x-api-key` — the SENTROPIC key sent via the `x-api-key` header. The
 *    Anthropic SDK sends its key as `x-api-key` (never `Authorization: Bearer`);
 *    so a client using `ANTHROPIC_BASE_URL=<gateway>` + the standard
 *    `ANTHROPIC_API_KEY` env reaches the gateway as `x-api-key`. The gateway
 *    accepts it as a caller-auth scheme (the VALUE is a sentropic key/token,
 *    NOT a provider key — the gateway swaps in the pooled provider credential).
 */
export type CallerAuthScheme = 'Bearer' | 'DPoP' | 'x-api-key';

/**
 * Token verification port — the documented stub seam for the OIDC/session edge.
 * Production binds this to `auth-hono` (iss/aud/scope/ath/jti). It resolves the
 * VERIFIED principal from a bearer/DPoP/x-api-key token, or `undefined` when invalid.
 */
export interface VerifyToken {
  verify(
    token: string,
    scheme: CallerAuthScheme,
    headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}

const parseAuthorization = (
  headers: Readonly<Record<string, string>>,
): { scheme: CallerAuthScheme; token: string } | undefined => {
  // Case-insensitive header lookup (Hono lowercases, but be defensive).
  const raw =
    headers['authorization'] ?? headers['Authorization'] ?? '';
  const [scheme, ...rest] = raw.trim().split(/\s+/);
  const token = rest.join(' ').trim();
  if (token) {
    if (scheme === 'Bearer') {
      return { scheme: 'Bearer', token };
    }
    if (scheme === 'DPoP') {
      return { scheme: 'DPoP', token };
    }
  }
  // Anthropic-SDK drop-in (spec §3): the sentropic key arrives as `x-api-key`.
  const apiKey = (headers['x-api-key'] ?? headers['X-Api-Key'] ?? '').trim();
  if (apiKey) {
    return { scheme: 'x-api-key', token: apiKey };
  }
  return undefined;
};

/**
 * A correlation-id source so the CostContext gets a request-unique id even when
 * the caller doesn't supply one. Defaults to a per-call random id; tests inject
 * a deterministic generator.
 */
export interface CorrelationSource {
  next(): string;
}

const defaultCorrelation: CorrelationSource = {
  next: () => `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
};

export interface PersonalPassthroughCallerAuthOptions {
  readonly verifyToken: VerifyToken;
  readonly correlation?: CorrelationSource;
  /** Header carrying a caller-supplied correlation id (e.g. `x-correlation-id`). */
  readonly correlationHeader?: string;
}

/**
 * Concrete v0 CallerAuthPort. Parses `Authorization`, verifies via the injected
 * `VerifyToken`, and builds the `CostContext` from the VERIFIED principal.
 */
export class PersonalPassthroughCallerAuth implements CallerAuthPort {
  private readonly verifyToken: VerifyToken;
  private readonly correlation: CorrelationSource;
  private readonly correlationHeader: string;

  constructor(options: PersonalPassthroughCallerAuthOptions) {
    this.verifyToken = options.verifyToken;
    this.correlation = options.correlation ?? defaultCorrelation;
    this.correlationHeader = options.correlationHeader ?? 'x-correlation-id';
  }

  async verify(
    headers: Readonly<Record<string, string>>,
  ): Promise<CallerAuthResult> {
    const parsed = parseAuthorization(headers);
    if (!parsed) {
      return { ok: false, reason: 'missing or malformed Authorization header' };
    }

    const principal = await this.verifyToken.verify(parsed.token, parsed.scheme, headers);
    if (!principal) {
      return { ok: false, reason: 'token verification failed' };
    }

    const correlationId =
      headers[this.correlationHeader]?.trim() || this.correlation.next();

    const cost: CostContext = {
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      ...(principal.ownerScopeRef ? { ownerScopeRef: principal.ownerScopeRef } : {}),
      source: principal.source,
      correlationId,
      ...(principal.workspaceId ? { workspaceId: principal.workspaceId } : {}),
      ...(principal.budgetScope ? { budgetScope: principal.budgetScope } : {}),
      callSite: 'llm-gateway',
    };

    return { ok: true, cost };
  }
}
