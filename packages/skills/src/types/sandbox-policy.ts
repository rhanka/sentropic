/**
 * Allowlist tag for a sandbox-exposed host API surface. The set is
 * intentionally narrow to match the SPEC_EVOL_BR19 §2 threat model.
 */
export type SandboxSurface =
  | 'files.create'
  | 'files.read'
  | 'db.query'
  | 'db.mutate'
  | 'fetch'
  | (string & {});

/**
 * Runtime policy enforced when a skill executes user-provided code inside the
 * sandbox runtime. Absence of `SandboxPolicy` on a `Skill` means the skill
 * exposes native handlers only (no code execution).
 */
export interface SandboxPolicy {
  /**
   * Allowlist of host capability surfaces the sandbox code may import.
   * An empty array means "pure compute, no host surface".
   */
  readonly surface: ReadonlyArray<SandboxSurface>;
  /** Hard execution timeout in milliseconds. Defaults to 30_000 at parse. */
  readonly timeoutMs: number;
  /** Hard memory cap in MiB enforced by the isolate. Defaults to 128 at parse. */
  readonly memoryMb: number;
}
