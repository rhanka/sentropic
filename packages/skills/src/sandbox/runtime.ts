import type { Skill } from '../types/skill.js';
import type { SandboxPolicy } from '../types/sandbox-policy.js';
import {
  type ResolvedSandboxPolicy,
  SANDBOX_DEFAULTS,
  resolveSandboxPolicy,
  SandboxDenied,
} from './policy.js';
import {
  buildSandboxApiSurface,
  type SandboxApiSurface,
} from './api-surface.js';

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
  readonly isolatedVmModule?: IsolatedVmModuleShape;
}

/**
 * Minimal shape of the `isolated-vm` module surface we depend on. Declared
 * locally to avoid a hard type dependency on `@types/isolated-vm` (the package
 * ships its own types but they are heavy; we only need a sliver).
 */
export interface IsolatedVmModuleShape {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Isolate: new (options: { memoryLimit: number }) => IsolatedVmIsolate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Reference: new (target: unknown) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ExternalCopy: new (value: unknown) => { copyInto(): unknown };
}

/** Subset of `isolated-vm` `Isolate` API used here. */
export interface IsolatedVmIsolate {
  createContext(): Promise<IsolatedVmContext>;
  compileScript(code: string): Promise<IsolatedVmScript>;
  dispose(): void;
  readonly isDisposed: boolean;
}

/** Subset of `isolated-vm` `Context` API used here. */
export interface IsolatedVmContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly global: { set(name: string, value: unknown, options?: any): Promise<void> };
  release?(): void;
}

/** Subset of `isolated-vm` `Script` API used here. */
export interface IsolatedVmScript {
  run(
    context: IsolatedVmContext,
    options?: { timeout?: number; promise?: boolean; copy?: boolean },
  ): Promise<unknown>;
  release?(): void;
}

/**
 * JavaScript source compiled and executed inside the isolate. It wires the
 * three allowed host bridges (`__hostFilesCreate`, `__hostDbQuery`,
 * `__hostFetch`) — each is an `ivm.Reference` to a host function — into the
 * friendly `files.create`, `db.query`, `fetch` API expected by skill authors.
 * The user code is wrapped as the body of an async function so it can `await`
 * the bridges. The final `return` value of `__userMain` is copied back to the
 * host as the sandbox result.
 */
function buildSandboxBootstrap(userCode: string): string {
  return `
"use strict";
const __noop = async () => { throw new Error('sandbox: host bridge not exposed'); };
const __callBridge = (ref) => async (...args) => {
  if (!ref) return __noop();
  return await ref.apply(undefined, args, {
    arguments: { copy: true },
    result: { promise: true, copy: true },
  });
};
const files = (typeof __hostFilesCreate !== 'undefined' && __hostFilesCreate)
  ? { create: __callBridge(__hostFilesCreate) }
  : undefined;
const db = (typeof __hostDbQuery !== 'undefined' && __hostDbQuery)
  ? { query: __callBridge(__hostDbQuery) }
  : undefined;
const fetch = (typeof __hostFetch !== 'undefined' && __hostFetch)
  ? __callBridge(__hostFetch)
  : undefined;
const __userMain = async (input) => {
${userCode}
};
__userMain(__userInput);
`;
}

/**
 * Lazily resolve the `isolated-vm` native addon. Cached on first call.
 */
async function loadIsolatedVm(): Promise<IsolatedVmModuleShape> {
  const mod = (await import('isolated-vm')) as unknown as {
    default?: IsolatedVmModuleShape;
  } & IsolatedVmModuleShape;
  return (mod.default ?? mod) as IsolatedVmModuleShape;
}

/**
 * Wire the API surface into the isolate context by exposing each host proxy
 * as an `ivm.Reference`. Functions return promises that the bootstrap script
 * resolves via `result: { promise: true, copy: true }`.
 */
async function injectApiSurface(
  ivm: IsolatedVmModuleShape,
  context: IsolatedVmContext,
  surface: SandboxApiSurface,
  args: Record<string, unknown>,
): Promise<void> {
  const setReference = async (name: string, fn: (...rest: unknown[]) => Promise<unknown>) => {
    await context.global.set(name, new ivm.Reference(fn));
  };

  if (surface.files) {
    await setReference('__hostFilesCreate', (input) => {
      return surface.files!.create(input as Parameters<NonNullable<SandboxApiSurface['files']>['create']>[0]);
    });
  }
  if (surface.db) {
    await setReference('__hostDbQuery', (input) => {
      return surface.db!.query(input as Parameters<NonNullable<SandboxApiSurface['db']>['query']>[0]);
    });
  }
  if (surface.fetch) {
    await setReference('__hostFetch', (url, init) => {
      return surface.fetch!(
        url as string,
        init as Parameters<NonNullable<SandboxApiSurface['fetch']>>[1],
      );
    });
  }

  await context.global.set('__userInput', new ivm.ExternalCopy(args).copyInto());
}

/**
 * Translate an isolated-vm runtime error into a `SandboxErrorCode`. The
 * `isolated-vm` addon throws plain `Error` instances whose `.message` carries
 * a distinct token for the three categories we care about.
 */
function classifyError(error: unknown): {
  code: SandboxErrorCode;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/Script execution timed out/i.test(message)) {
    return { code: 'SANDBOX_TIMEOUT', message };
  }
  if (
    /Array buffer allocation failed|Isolate was disposed|memory limit/i.test(
      message,
    ) ||
    /JavaScript heap out of memory/i.test(message)
  ) {
    return { code: 'SANDBOX_OOM', message };
  }
  if (error instanceof SandboxDenied) {
    return { code: 'SANDBOX_DENIED', message };
  }
  if (/sandbox: host bridge not exposed/i.test(message)) {
    return { code: 'SANDBOX_DENIED', message };
  }
  return { code: 'SANDBOX_THROW', message };
}

/**
 * Construct a `SandboxRuntime` backed by `isolated-vm`. Lazy import: the
 * native addon is loaded only when the first call to `execute()` happens, so
 * environments that never instantiate a sandbox-policy skill don't pay the
 * build cost.
 */
export function createIsolatedVmRuntime(
  options: IsolatedVmRuntimeOptions = {},
): SandboxRuntime {
  let ivm: IsolatedVmModuleShape | undefined = options.isolatedVmModule;
  const liveIsolates = new Set<IsolatedVmIsolate>();

  const ensureIvm = async (): Promise<IsolatedVmModuleShape> => {
    if (ivm) return ivm;
    ivm = await loadIsolatedVm();
    return ivm;
  };

  return {
    async execute(skill, args, opts = {}): Promise<SandboxResult> {
      const policy = resolveSandboxPolicy(
        opts.policyOverride ?? skill.metadata.sandbox,
      );
      const started = Date.now();

      if (!skill.sandboxEntry || skill.sandboxEntry.length === 0) {
        return {
          ok: false,
          errorCode: 'SANDBOX_INTERNAL',
          errorMessage: 'skill.sandboxEntry is empty; nothing to execute',
          durationMs: Date.now() - started,
          policy,
        };
      }

      let resolvedIvm: IsolatedVmModuleShape;
      try {
        resolvedIvm = await ensureIvm();
      } catch (error) {
        return {
          ok: false,
          errorCode: 'SANDBOX_INTERNAL',
          errorMessage: `isolated-vm unavailable: ${(error as Error).message}`,
          durationMs: Date.now() - started,
          policy,
        };
      }

      const { surface } = buildSandboxApiSurface(policy, options.adapters);
      let isolate: IsolatedVmIsolate | undefined;
      let context: IsolatedVmContext | undefined;
      let script: IsolatedVmScript | undefined;

      try {
        isolate = new resolvedIvm.Isolate({ memoryLimit: policy.memoryMb });
        liveIsolates.add(isolate);
        context = await isolate.createContext();
        await injectApiSurface(resolvedIvm, context, surface, args);

        const bootstrap = buildSandboxBootstrap(skill.sandboxEntry);
        script = await isolate.compileScript(bootstrap);

        const raw = await script.run(context, {
          timeout: policy.timeoutMs,
          promise: true,
          copy: true,
        });
        return {
          ok: true,
          output: raw,
          durationMs: Date.now() - started,
          policy,
        };
      } catch (error) {
        const { code, message } = classifyError(error);
        return {
          ok: false,
          errorCode: code,
          errorMessage: message,
          durationMs: Date.now() - started,
          policy,
        };
      } finally {
        try {
          script?.release?.();
        } catch {
          // ignore
        }
        try {
          context?.release?.();
        } catch {
          // ignore
        }
        if (isolate) {
          liveIsolates.delete(isolate);
          try {
            if (!isolate.isDisposed) isolate.dispose();
          } catch {
            // ignore
          }
        }
      }
    },

    async dispose(): Promise<void> {
      for (const isolate of liveIsolates) {
        try {
          if (!isolate.isDisposed) isolate.dispose();
        } catch {
          // best-effort teardown
        }
      }
      liveIsolates.clear();
    },
  };
}

/**
 * Re-export defaults so consumers can introspect the sandbox limits without
 * pulling the policy module directly.
 */
export const SANDBOX_RUNTIME_DEFAULTS = SANDBOX_DEFAULTS;
