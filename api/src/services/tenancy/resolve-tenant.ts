/**
 * ARCH-11 G1b — the single product-side `workspace → tenant` seam (spec §3).
 *
 * One fail-closed resolver + an in-process cache is the sole source of truth downstream
 * consumers depend on. It NEVER returns a `workspaceId` as a `tenantId` (it always reads the
 * real `tenants`-slug columns G1a added), and an unresolved input DENIES (never defaults).
 *
 * `reconcileTenantId` is the mode-aware wrapper the alias sites call: it honours
 * `TENANT_RESOLUTION_MODE` (spec §4.3) so `alias` is pure legacy, `shadow` measures without
 * changing behavior, and `strict` uses the resolver authoritatively and fail-closes.
 *
 * Scope note (G1b): `{ itemRef }` (connector-owned, bank §4.1) is OUT of scope — the token-side
 * authority (`mcp-platform` `resolveAuthorizedTenant`) and the OBO mint land in G1c.
 */
import { and, eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { db } from '../../db/client';
import { logger } from '../../logger';
import { serviceClients, tenantMemberships, workspaces } from '../../db/schema';
import {
  recordTenantResolution,
  recordTenantResolutionDivergence,
} from './tenant-resolution-metrics';

/**
 * Inputs the product path can resolve a tenant from (spec §3, minus `{ itemRef }`):
 *  - `{ workspaceId }`         → the workspace's `tenant_id` (G1a column).
 *  - `{ workspaceId, userId }` → the above WITH an approved `tenant_memberships` cross-check
 *                                (the acting user must belong to the org the workspace claims).
 *  - `{ clientId }`            → `service_clients.tenant_id` (S2S source; NOT `oauth_clients`).
 *  - `{ userId }`             → the user's single approved membership (multi → ambiguous).
 */
export type ResolveTenantInput =
  | { workspaceId: string; userId?: string }
  | { clientId: string }
  | { userId: string };

export type ResolveTenantResult =
  | { tenantId: string }
  | { error: 'unknown' | 'ambiguous_tenant' };

/** Raised by `reconcileTenantId` in STRICT mode when a tenant cannot be resolved (fail-closed). */
export class TenantResolutionError extends Error {
  constructor(
    public readonly reason: 'unknown' | 'ambiguous_tenant',
    public readonly path: string,
    public readonly workspaceId: string,
  ) {
    super(`tenant resolution failed (${reason}) at '${path}' for workspace '${workspaceId}'`);
    this.name = 'TenantResolutionError';
  }
}

// -----------------------------------------------------------------------------
// In-process cache (spec §3 invariant 3: idempotent + cacheable).
// Process-lifetime Map — invalidation/TTL is a STRICT-mode (G1c) follow-up; in shadow the
// only consequence of staleness is a mismeasured divergence, never wrong behavior. Tests
// clear it via `resetResolveTenantCache()`.
// -----------------------------------------------------------------------------
const cache = new Map<string, ResolveTenantResult>();

function cacheKey(input: ResolveTenantInput): string {
  if ('clientId' in input) return `cl:${input.clientId}`;
  if ('workspaceId' in input) {
    return input.userId ? `ws:${input.workspaceId}|u:${input.userId}` : `ws:${input.workspaceId}`;
  }
  return `u:${input.userId}`;
}

/** Test/ops helper: clear the in-process resolution cache. */
export function resetResolveTenantCache(): void {
  cache.clear();
}

async function resolveByWorkspace(workspaceId: string, userId?: string): Promise<ResolveTenantResult> {
  const [ws] = await db
    .select({ tenantId: workspaces.tenantId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws?.tenantId) return { error: 'unknown' };

  // Membership cross-check: the acting user must be an APPROVED member of the org the
  // workspace claims. Missing membership = fail-closed (`ambiguous_tenant`) — the user cannot
  // be authoritatively attributed to this tenant. Skipped when no userId is supplied (a pure
  // workspace→tenant lookup, e.g. background seeding).
  if (userId) {
    const [membership] = await db
      .select({ status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, ws.tenantId), eq(tenantMemberships.userId, userId)))
      .limit(1);
    if (!membership || membership.status !== 'approved') return { error: 'ambiguous_tenant' };
  }
  return { tenantId: ws.tenantId };
}

/**
 * Resolve a user-bound workspace without the process cache. Authorization boundaries use this
 * path so membership revocation is observed on the next check rather than after a restart.
 */
export async function resolveTenantAuthoritatively(input: {
  workspaceId: string;
  userId: string;
}): Promise<ResolveTenantResult> {
  return resolveByWorkspace(input.workspaceId, input.userId);
}

async function resolveByClient(clientId: string): Promise<ResolveTenantResult> {
  const [row] = await db
    .select({ tenantId: serviceClients.tenantId })
    .from(serviceClients)
    .where(eq(serviceClients.clientId, clientId))
    .limit(1);
  if (!row?.tenantId) return { error: 'unknown' };
  return { tenantId: row.tenantId };
}

async function resolveByUser(userId: string): Promise<ResolveTenantResult> {
  const rows = await db
    .select({ tenantId: tenantMemberships.tenantId })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'approved')));
  if (rows.length === 0) return { error: 'unknown' };
  if (rows.length > 1) return { error: 'ambiguous_tenant' };
  return { tenantId: rows[0]!.tenantId };
}

/**
 * Resolve the real tenant for one input (spec §3). Fail-closed: an unresolved input returns an
 * `error`, never a `workspaceId`. Cached in-process (idempotent). Only successful resolutions
 * AND fail-closed denials are cached — both are stable given the current DB row set.
 */
export async function resolveTenant(input: ResolveTenantInput): Promise<ResolveTenantResult> {
  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;

  let result: ResolveTenantResult;
  if ('clientId' in input) {
    result = await resolveByClient(input.clientId);
  } else if ('workspaceId' in input) {
    result = await resolveByWorkspace(input.workspaceId, input.userId);
  } else {
    result = await resolveByUser(input.userId);
  }

  cache.set(key, result);
  return result;
}

/**
 * Mode-aware alias-site wrapper (spec §4.3). Returns the `tenantId` a call site should USE:
 *  - `alias`  → the legacy `workspaceId`, with NO resolver call (pure legacy, zero cost).
 *  - `shadow` → the legacy `workspaceId` (ZERO behavior change); resolves in parallel and
 *               records `tenant_resolution_total` + `tenant_resolution_divergence_total` when
 *               the resolution would fail-close under strict (see the divergence note below).
 *  - `strict` → the resolved real tenant; throws `TenantResolutionError` on any failure.
 *
 * Divergence semantics (BR-G1b-N1): `tenantId := workspaceId` (a UUID) and the resolved real
 * tenant (a slug) are structurally never equal, so a literal value-mismatch counter would be a
 * permanent ~100% and could never reach the §4.3 "divergence = 0" gate. On the product/cookie
 * path there is no token `tid` to cross-check. So the divergence COUNTER increments only when
 * `resolveTenant` returns an error — i.e. exactly when strict WOULD fail-close on live traffic.
 * That is the achievable-0 signal proving backfill completeness before the owner-signed cutover.
 */
export async function reconcileTenantId(input: {
  workspaceId: string;
  userId?: string;
  path: string;
}): Promise<string> {
  const legacy = input.workspaceId;
  const mode = env.TENANT_RESOLUTION_MODE;

  // alias: pure legacy — never touch the resolver.
  if (mode === 'alias') return legacy;

  const query: ResolveTenantInput = input.userId
    ? { workspaceId: input.workspaceId, userId: input.userId }
    : { workspaceId: input.workspaceId };
  const resolved = await resolveTenant(query);

  if (mode === 'strict') {
    if ('error' in resolved) {
      throw new TenantResolutionError(resolved.error, input.path, legacy);
    }
    return resolved.tenantId;
  }

  // shadow: measure, then return the legacy value so behavior is byte-identical to `alias`.
  recordTenantResolution(input.path);
  if ('error' in resolved) {
    recordTenantResolutionDivergence(input.path);
    logger.warn(
      {
        metric: 'tenant_resolution_divergence_total',
        mode: 'shadow',
        path: input.path,
        pod: process.env.HOSTNAME ?? 'unknown',
        error: resolved.error,
        workspaceId: legacy,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      'tenant_resolution_divergence',
    );
  }
  return legacy;
}
