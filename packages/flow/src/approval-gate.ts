/**
 * @sentropic/flow — ApprovalGate port.
 *
 * Wraps gate evaluation (`gate-service.ts`) and exposes the
 * `signal()` operation that today is inlined inside
 * `TodoOrchestrationService.resumeRun`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2 + §8 (BR26-Q1: extract
 * `signal()` at Lot 4 to lock the boundary early).
 */

export type GateMode = 'free' | 'soft' | 'hard';

export interface GateCriteria {
  required_fields: string[];
  guardrail_categories: string[];
}

export interface GateConfig {
  mode: GateMode;
  stages: string[];
  criteria?: Record<string, GateCriteria>;
}

export interface GateEvaluationResult {
  gate_passed: boolean;
  warnings: string[];
  blockers: string[];
}

export type GateDecision = 'approved' | 'rejected';

export interface ApprovalGate<TWorkspaceType = string> {
  /** Read the workspace gate config (with workspace-level override). */
  resolveConfig(workspaceId: string): Promise<GateConfig | null>;

  /** Get the static default gate config for a workspace type. */
  getDefaultConfig(type: TWorkspaceType): GateConfig | null;

  /** Evaluate a stage transition against the gate config. */
  evaluate(
    workspaceId: string,
    entityId: string,
    targetStage: string,
  ): Promise<GateEvaluationResult>;

  /**
   * Signal a manual approval decision on a paused run.
   *
   * BR26-Q1: extracted from inline `resumeRun` semantics at Lot 4 to
   * lock the boundary early. Implementations route the signal through
   * the existing `resumeRun` workflow.
   */
  signal(runId: string, decision: GateDecision): Promise<void>;
}
