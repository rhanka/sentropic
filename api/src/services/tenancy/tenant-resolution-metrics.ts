/**
 * ARCH-11 G1b (spec §4.3) — provider-neutral, IN-PROCESS tenant-resolution counters.
 *
 * Mirrors `services/comments/comment-metrics.ts`: the SMALLEST possible primitive —
 * module-level `Map<path, count>` tallies, NO metrics backend, NO Prometheus/OTel
 * exporter. The shadow-mode reconcile choke-point (`reconcileTenantId`) increments a
 * per-`path` denominator on every resolution and a per-`path` divergence counter when the
 * resolution that STRICT mode would rely on fails (`unknown`/`ambiguous_tenant`). The
 * `{mode,path,pod}` label semantics live in the caller's structured log line; here we keep
 * only the raw tallies so a snapshot/gate can read `divergence == 0` per path.
 *
 * DEFERRED (spec §5): external metrics backend, per-pod aggregation across processes,
 * dashboards. `pod` is a log label, not a Map key (each process is one pod).
 */

/** In-process denominator: total shadow resolutions attempted, keyed by call-site `path`. */
const tenantResolutionTotals = new Map<string, number>();

/** In-process numerator: resolutions that would fail-close under strict, keyed by `path`. */
const tenantResolutionDivergences = new Map<string, number>();

/** Increment the `tenant_resolution_total` denominator for one shadow resolution. */
export function recordTenantResolution(path: string): void {
  tenantResolutionTotals.set(path, (tenantResolutionTotals.get(path) ?? 0) + 1);
}

/** Increment the `tenant_resolution_divergence_total` counter for a fail-close divergence. */
export function recordTenantResolutionDivergence(path: string): void {
  tenantResolutionDivergences.set(path, (tenantResolutionDivergences.get(path) ?? 0) + 1);
}

/**
 * Snapshot reader: `{ total, divergence }` as plain `path -> count` objects for this
 * process. Returns copies so callers cannot mutate the tallies. A cutover gate reads
 * `divergence` (must be all-zero across the deploy window before flipping strict).
 */
export function getTenantResolutionMetrics(): {
  total: Record<string, number>;
  divergence: Record<string, number>;
} {
  return {
    total: Object.fromEntries(tenantResolutionTotals),
    divergence: Object.fromEntries(tenantResolutionDivergences),
  };
}

/** Test helper: reset both in-process tallies (no production caller). */
export function resetTenantResolutionMetrics(): void {
  tenantResolutionTotals.clear();
  tenantResolutionDivergences.clear();
}
