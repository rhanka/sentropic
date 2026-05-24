import type { SandboxPolicy, SandboxSurface } from '../types/sandbox-policy.js';

/**
 * Hard ceilings the runtime enforces regardless of what a `SKILL.md` declares.
 * If a `SandboxPolicy.timeoutMs` or `memoryMb` exceeds these, the value is
 * clamped down at resolve time and a warning surfaces in the resolved policy.
 */
export const SANDBOX_HARD_LIMITS = Object.freeze({
  /** Absolute cap on per-call wall-clock execution. */
  maxTimeoutMs: 60_000,
  /** Absolute cap on per-isolate heap (MiB). */
  maxMemoryMb: 256,
});

/** Defaults applied when the policy field is missing on a parsed skill. */
export const SANDBOX_DEFAULTS = Object.freeze({
  timeoutMs: 30_000,
  memoryMb: 128,
  surface: Object.freeze<readonly SandboxSurface[]>([]),
});

/**
 * Canonical, defensive policy returned by `resolveSandboxPolicy`. Values are
 * guaranteed within `SANDBOX_HARD_LIMITS`; `surface` is deduplicated and
 * frozen so downstream wrappers can rely on equality / inclusion checks.
 */
export interface ResolvedSandboxPolicy {
  readonly surface: ReadonlyArray<SandboxSurface>;
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Normalize a (possibly-undefined) policy into a `ResolvedSandboxPolicy` with
 * defaults + hard caps. Invariants:
 *   - timeoutMs ∈ [1, SANDBOX_HARD_LIMITS.maxTimeoutMs]
 *   - memoryMb ∈ [8, SANDBOX_HARD_LIMITS.maxMemoryMb]
 *   - surface is deduplicated and frozen
 */
export function resolveSandboxPolicy(
  policy: SandboxPolicy | undefined,
): ResolvedSandboxPolicy {
  const warnings: string[] = [];
  const requested = policy ?? {
    surface: SANDBOX_DEFAULTS.surface,
    timeoutMs: SANDBOX_DEFAULTS.timeoutMs,
    memoryMb: SANDBOX_DEFAULTS.memoryMb,
  };

  let timeoutMs = requested.timeoutMs ?? SANDBOX_DEFAULTS.timeoutMs;
  if (timeoutMs <= 0) {
    warnings.push('timeoutMs ≤ 0; clamped to default (30000 ms)');
    timeoutMs = SANDBOX_DEFAULTS.timeoutMs;
  }
  if (timeoutMs > SANDBOX_HARD_LIMITS.maxTimeoutMs) {
    warnings.push(
      `timeoutMs (${timeoutMs}) exceeds hard limit; clamped to ${SANDBOX_HARD_LIMITS.maxTimeoutMs}`,
    );
    timeoutMs = SANDBOX_HARD_LIMITS.maxTimeoutMs;
  }

  let memoryMb = requested.memoryMb ?? SANDBOX_DEFAULTS.memoryMb;
  if (memoryMb < 8) {
    warnings.push('memoryMb < 8; clamped to default (128 MiB)');
    memoryMb = SANDBOX_DEFAULTS.memoryMb;
  }
  if (memoryMb > SANDBOX_HARD_LIMITS.maxMemoryMb) {
    warnings.push(
      `memoryMb (${memoryMb}) exceeds hard limit; clamped to ${SANDBOX_HARD_LIMITS.maxMemoryMb}`,
    );
    memoryMb = SANDBOX_HARD_LIMITS.maxMemoryMb;
  }

  const dedupedSurface: SandboxSurface[] = [];
  const seen = new Set<string>();
  for (const surface of requested.surface ?? []) {
    if (typeof surface !== 'string' || surface.length === 0) continue;
    if (seen.has(surface)) continue;
    seen.add(surface);
    dedupedSurface.push(surface);
  }

  return Object.freeze({
    surface: Object.freeze(dedupedSurface) as ReadonlyArray<SandboxSurface>,
    timeoutMs,
    memoryMb,
    warnings: Object.freeze(warnings) as ReadonlyArray<string>,
  });
}

/**
 * Pure check: does the resolved policy grant a given host surface to the
 * sandboxed code? Used both at API-surface wiring and inside the host-side
 * proxies as a second-line defence.
 */
export function policyAllowsSurface(
  policy: ResolvedSandboxPolicy,
  surface: SandboxSurface,
): boolean {
  return policy.surface.includes(surface);
}

/**
 * Structured error raised when the runtime denies a surface call (defence in
 * depth — the host proxy must check even though the wrapper isn't injected
 * when the surface is absent).
 */
export class SandboxDenied extends Error {
  constructor(
    public readonly surface: SandboxSurface,
    message?: string,
  ) {
    super(message ?? `Sandbox surface "${surface}" is not in the policy allowlist`);
    this.name = 'SandboxDenied';
  }
}
