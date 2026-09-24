/**
 * v0 personal-passthrough CallerAuthPort (spec §2/§7 D0).
 *
 * Personal-passthrough = the caller IS the provider (1 caller = their OWN
 * enrolled accounts, ToS-conforming). So caller-auth here:
 *   1. verifies a SENTROPIC bearer/session token (NOT provider auth);
 *   2. resolves the caller's OWN provider identity (caller == provider);
 *   3. resolves the `CostContext` from the VERIFIED identity, NEVER the body.
 *
 * Signature verification is supplied through `VerifyToken`. Service mode uses
 * `ServiceAuthVerifyToken` from /auth with canonical mcp-auth/hono verification
 * and bound DPoP. Session mode uses `AuthHonoVerifyToken` from /auth-hono with
 * auth-hono/middleware and rejects DPoP. Trusted custom verifiers and deterministic
 * test fixtures implement the same port; identity mapping stays host-owned.
 */

import type { CallerAuthPort, CallerAuthResult, CallerAuthRequestContext } from '../ports/caller-auth.js';
import { validateAuthContext } from '../internal/caller-auth.js';
import { parseCallerCredential } from '../internal/auth-bridge.js';
import type { CostContext, CostContextResolver } from '../ports/cost-context.js';

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
 * Token verification port for one explicitly selected credential family.
 * Service /auth verifies through mcp-auth/hono; session /auth-hono verifies
 * through auth-hono/middleware. Resolve a trusted principal or return undefined
 * on denial; unavailable verification throws. No cross-family fallback.
 */
export interface VerifyToken {
  verify(
    token: string,
    scheme: CallerAuthScheme,
    headers: Readonly<Record<string, string>>,
    context: CallerAuthRequestContext,
  ): Promise<VerifiedPrincipal | undefined> | VerifiedPrincipal | undefined;
}

const parseAuthorization = parseCallerCredential;

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
  readonly costContextResolver?: CostContextResolver;
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
  private readonly costContextResolver?: CostContextResolver;

  constructor(options: PersonalPassthroughCallerAuthOptions) {
    if (options.costContextResolver && (options.correlation !== undefined || options.correlationHeader !== undefined)) {
      throw new Error('costContextResolver cannot be combined with correlation options');
    }
    this.costContextResolver = options.costContextResolver;
    this.verifyToken = options.verifyToken;
    this.correlation = options.correlation ?? defaultCorrelation;
    this.correlationHeader = options.correlationHeader ?? 'x-correlation-id';
  }

  async verify(
    headers: Readonly<Record<string, string>>,
    context: CallerAuthRequestContext,
  ): Promise<CallerAuthResult> {
    validateAuthContext(context);
    const parsed = parseAuthorization(headers);
    if (!parsed) {
      return { ok: false, reason: 'missing or malformed Authorization header' };
    }

    const principal = await this.verifyToken.verify(parsed.token, parsed.scheme, headers, context);
    if (!principal) {
      return { ok: false, reason: 'token verification failed' };
    }

    const cost = this.costContextResolver
      ? await this.costContextResolver.resolve(principal, context)
      : this.projectLegacyCost(principal, headers);
    context.signal?.throwIfAborted();
    return cost ? { ok: true, cost } : { ok: false, reason: 'cost context denied' };
  }

  private projectLegacyCost(principal: VerifiedPrincipal, headers: Readonly<Record<string, string>>): CostContext {
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

    return cost;
  }
}
