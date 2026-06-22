/**
 * CallerAuthPort (spec §2/§3). Verifies the SENTROPIC caller identity (NOT
 * provider auth): `Authorization: Bearer <OIDC/session>` OR `DPoP <token>` +
 * proof for S2S, via `auth-hono` service-auth-middleware (iss/aud/scope/ath/jti).
 * Resolves the `CostContext` from the VERIFIED identity, never the body.
 *
 * v0 stub: interface only. Lot 2 wires the concrete `auth-hono` verifier.
 */

import type { CostContext } from './cost-context.js';

export interface CallerAuthResult {
  readonly ok: boolean;
  readonly cost?: CostContext;
  /** Provider-shaped reason when verification fails (mapped to a 401 body). */
  readonly reason?: string;
}

export interface CallerAuthPort {
  /** Verify the caller from request headers; resolve the CostContext. */
  verify(headers: Readonly<Record<string, string>>): Promise<CallerAuthResult>;
}
