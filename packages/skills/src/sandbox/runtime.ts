import type { Skill } from '../types/skill.js';
import type { SandboxPolicy } from '../types/sandbox-policy.js';
import {
  type ResolvedSandboxPolicy,
  SANDBOX_DEFAULTS,
  resolveSandboxPolicy,
} from './policy.js';

/**
 * Standardized error codes surfaced as `SandboxResult.errorCode` so chat-core
 * (and the UI) can branch on category without parsing error messages.
 */
export type SandboxErrorCode =
  | 'SANDBOX_TIMEOUT'
  | 'SANDBOX_OOM'
  | 'SANDBOX_DENIED'
  | 'SANDBOX_THROW'
  | 'SANDBOX_INVALID_RESULT'
  | 'SANDBOX_INTERNAL';

/**
 * Outcome of a single `SandboxRuntime.execute()` call. Successful runs carry
 * `output` (raw return value from the sandboxed entrypoint); failed runs carry
 * `errorCode` + `errorMessage`. Both branches surface `policy` (resolved) and
 * the wall-clock `durationMs` for observability.
 */
export interface SandboxResult {
  readonly ok: boolean;
  readonly output?: unknown;
  readonly errorCode?: SandboxErrorCode;
  readonly errorMessage?: string;
  readonly durationMs: number;
  readonly policy: ResolvedSandboxPolicy;
}

/**
 * Adapters the host provides to the runtime so the allowed surfaces (files,
 * db, fetch) can proxy back to real services. Each is optional; if a surface
 * is declared by the policy but the adapter is missing, calls fail with
 * `SANDBOX_DENIED` at wrapper time.
 *
 * Adapters are *injected at construction time* — never resolved from process
 * globals. This keeps the runtime testable and prevents sandbox code from
 * reaching unintended host capabilities through ambient state.
 */
export interface SandboxHostAdapters {
  readonly files?: {
    create(input: {
      name: string;
      mimeType: string;
      content: Uint8Array | string;
    }): Promise<{ artefactId: string; mimeType: string }>;
  };
  readonly db?: {
    query(input: {
      sql: string;
      params?: ReadonlyArray<unknown>;
    }): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  };
  readonly fetch?: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

/**
 * Optional per-call overrides. `policyOverride` is reserved for testing —
 * production callers should always rely on `skill.metadata.sandbox`.
 */
export interface SandboxExecuteOptions {
  readonly policyOverride?: SandboxPolicy;
  readonly signal?: AbortSignal;
}

/**
 * Port (interface) for the sandbox runtime. The default adapter ships with
 * `isolated-vm` (per SPEC_EVOL_BR19 §2). Alternative adapters (`quickjs`, mock
 * in-process executor for tests) implement the same shape.
 */
export interface SandboxRuntime {
  execute(
    skill: Skill,
    args: Record<string, unknown>,
    options?: SandboxExecuteOptions,
  ): Promise<SandboxResult>;
  /** Cleanup any retained isolates / pools. Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Construction options for the concrete `IsolatedVmSandboxRuntime`. Adapters
 * are required when the consumer ships sandbox-policy skills that declare
 * those surfaces; runtime accepts an empty object for pure-compute skills.
 */
export interface IsolatedVmRuntimeOptions {
  readonly adapters?: SandboxHostAdapters;
  /**
   * Optional dependency-injection seam used by tests to swap the real
   * `isolated-vm` module for a deterministic mock. Production callers pass
   * `undefined` (the runtime resolves the dep itself via dynamic import).
   */
  readonly isolatedVmModule?: unknown;
}

/**
 * Construct a `SandboxRuntime` backed by `isolated-vm`. Lazy import: the
 * native addon is loaded only when the first call to `execute()` happens, so
 * environments that never instantiate a sandbox-policy skill don't pay the
 * build cost. The execute body is implemented in `./runtime-execute.ts`
 * (deferred to BR-19 Lot 2 Step 3).
 */
export function createIsolatedVmRuntime(
  options: IsolatedVmRuntimeOptions = {},
): SandboxRuntime {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let isolatedVm: any = options.isolatedVmModule;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let liveIsolates: any[] = [];

  const ensureIsolatedVm = async (): Promise<unknown> => {
    if (isolatedVm) return isolatedVm;
    isolatedVm = await import('isolated-vm');
    return isolatedVm;
  };

  return {
    async execute(skill, args, opts = {}): Promise<SandboxResult> {
      const policy = resolveSandboxPolicy(opts.policyOverride ?? skill.metadata.sandbox);
      const started = Date.now();
      try {
        await ensureIsolatedVm();
      } catch (error) {
        return {
          ok: false,
          errorCode: 'SANDBOX_INTERNAL',
          errorMessage: `isolated-vm unavailable: ${(error as Error).message}`,
          durationMs: Date.now() - started,
          policy,
        };
      }
      // Execution body is provided by ./runtime-execute.ts in Lot 2 Step 3.
      // Until then, surface a deterministic "not implemented" failure so the
      // typecheck-skills gate stays green without enabling unsound exec paths.
      void args;
      void liveIsolates;
      return {
        ok: false,
        errorCode: 'SANDBOX_INTERNAL',
        errorMessage: 'SandboxRuntime.execute is not yet implemented (Lot 2 Step 3)',
        durationMs: Date.now() - started,
        policy,
      };
    },

    async dispose(): Promise<void> {
      for (const isolate of liveIsolates) {
        try {
          isolate.dispose();
        } catch {
          // best-effort teardown
        }
      }
      liveIsolates = [];
    },
  };
}

/**
 * Re-export defaults so consumers can introspect the sandbox limits without
 * pulling the policy module directly.
 */
export const SANDBOX_RUNTIME_DEFAULTS = SANDBOX_DEFAULTS;
