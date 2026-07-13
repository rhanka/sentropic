/**
 * Slice 2 — Deny-as-missing discovery (frozen, dependency-free helper).
 *
 * `listVisibleCapabilities`: authz-projected discovery (§7.1). Capabilities the
 * principal cannot access are ABSENT from the listing, never shown as "denied"
 * (deny-as-missing).
 *
 * R1a (BR-42l): this module is the FROZEN read-only slice of the former
 * `guard.ts`. It imports ONLY the pure `AppCapability` type from `./manifest.js`
 * so the frozen root `.` never structurally depends on an unstable
 * (mutation-gate / elicitation / audit) symbol. The mutation-gating half moved to
 * `./experimental/mutation-gate.js`.
 */
import type { AppCapability } from './manifest.js';

export type VisibilityContext = {
  scopes: string[];
  claims: string[]; // claim names the principal holds
  tenantRef: string;
  accessibleTenants: string[]; // tenants the principal is authorized for
};

/** Authz-projected, deny-as-missing capability listing (§7.1). */
export function listVisibleCapabilities(
  capabilities: AppCapability[],
  ctx: VisibilityContext,
): AppCapability[] {
  if (!ctx.accessibleTenants.includes(ctx.tenantRef)) return []; // tenant not accessible → nothing leaks
  return capabilities.filter((cap) => {
    const hasScopes = cap.requiredScopes.every((s) => ctx.scopes.includes(s));
    const hasClaims = cap.requiredClaims.every((c) => ctx.claims.includes(c));
    return hasScopes && hasClaims;
  });
}
