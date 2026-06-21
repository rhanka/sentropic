/**
 * ResourceAuthzProjector — net-new authz projection for the resource plane (RF5).
 *
 * Separate discover / read / invoke decisions + deny-as-missing (the dispatcher maps
 * a failed `discover` to `not_found`, never `denied`, so the namespace is not an
 * existence oracle). For catalog entries the availability gate mirrors
 * `packages/skills/src/registry/resolve.ts` `isSkillVisibleTo` + `isToolCallableUnder`
 * (NOT reused directly: `SkillMetadata` requires `version`/`category` that
 * `CatalogEntryMetadata` leaves optional). It deliberately does NOT reuse
 * `CatalogExecutionSeam`, which trusts prior `SkillsToolRegistry` filtering.
 */

import type { CatalogEntryMetadata } from '../catalog/types.js';
import type { ResourcePrincipal } from './contract.js';

export interface ResourceAccess {
  /** May the principal see that this resource exists (list/stat)? */
  readonly discover: boolean;
  /** May the principal read its content (read/grep)? */
  readonly read: boolean;
  /** May the principal invoke it (deferred verb; honored when invoke lands)? */
  readonly invoke: boolean;
}

/** Catalog authz inputs derived (server-side) from the request principal. */
export interface CatalogAuthzPrincipal {
  readonly workspaceType?: string;
  readonly roles: ReadonlyArray<string>;
  readonly permissions: ReadonlyArray<string>;
  readonly permissionMode: 'allowlist' | 'open';
  readonly allowedTools: ReadonlyArray<string>;
}

/**
 * Project the generic plane principal's `context` into the catalog authz inputs.
 * The shape is supplied by the caller of the plane (server-derived from the chat
 * authz context), never trusted from an LLM argument.
 */
export function catalogAuthzFromPrincipal(principal: ResourcePrincipal): CatalogAuthzPrincipal {
  const ctx = (principal.context ?? {}) as Partial<CatalogAuthzPrincipal>;
  return {
    workspaceType: ctx.workspaceType,
    roles: ctx.roles ?? [],
    permissions: ctx.permissions ?? [],
    permissionMode: ctx.permissionMode ?? 'open',
    allowedTools: ctx.allowedTools ?? [],
  };
}

/**
 * Availability gate — mirrors `isSkillVisibleTo`: AND of
 * `contextFilter.workspaceTypes`, `contextFilter.roles`, `authzRequirements.permissions`.
 */
function isAvailable(meta: CatalogEntryMetadata, p: CatalogAuthzPrincipal): boolean {
  const cf = meta.contextFilter;
  if (cf?.workspaceTypes && cf.workspaceTypes.length > 0) {
    if (!p.workspaceType || !cf.workspaceTypes.includes(p.workspaceType)) return false;
  }
  if (cf?.roles && cf.roles.length > 0) {
    if (!cf.roles.some((r) => p.roles.includes(r))) return false;
  }
  const required = meta.authzRequirements?.permissions;
  if (required && required.length > 0) {
    if (!required.every((perm) => p.permissions.includes(perm))) return false;
  }
  return true;
}

export class ResourceAuthzProjector {
  /**
   * Evaluate discover/read/invoke for a catalog entry. In v0 discover and read
   * collapse to the availability gate; invoke additionally honors allowlist mode
   * (mirrors `isToolCallableUnder`). The three are kept distinct in the result so
   * a future provider can diverge them without an API change.
   */
  catalogAccess(meta: CatalogEntryMetadata, principal: ResourcePrincipal): ResourceAccess {
    const p = catalogAuthzFromPrincipal(principal);
    const available = isAvailable(meta, p);
    const invoke = available && (p.permissionMode === 'open' || p.allowedTools.includes(meta.name));
    return { discover: available, read: available, invoke };
  }
}

export const resourceAuthzProjector = new ResourceAuthzProjector();
