/**
 * CallerAuthPort (spec §2/§3). Verifies the SENTROPIC caller identity (NOT
 * provider auth): `Authorization: Bearer <OIDC/session>` OR `DPoP <token>` +
 * proof for S2S, via the optional canonical service or session bridges.
 * Resolves the `CostContext` from the VERIFIED identity, never the body.
 *
 * Request context comes from trusted ingress, never forwarded identity headers.
 */

import type { CostContext } from './cost-context.js';

export interface CallerAuthRequestContext {
  readonly method: string;
  /** Absolute externally addressed HTTP(S) URL supplied by trusted ingress. */
  readonly url: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

export type CallerAuthResult =
  | { readonly ok: true; readonly cost: CostContext; readonly reason?: never }
  | { readonly ok: false; readonly cost?: never; readonly reason?: string };

export interface CallerAuthPort {
  /** Verify the caller from request headers; resolve the CostContext. */
  verify(headers: Readonly<Record<string, string>>, context: CallerAuthRequestContext):
    Promise<CallerAuthResult>;
}
