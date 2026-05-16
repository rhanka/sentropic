import type {
  ApprovalGate,
  GateConfig,
  GateDecision,
  GateEvaluationResult,
} from '@sentropic/flow';
import {
  evaluateGate,
  getDefaultGateConfig,
  resolveGateConfig,
} from '../gate-service';
import type { WorkspaceType } from '../workspace-access';
import { todoOrchestrationService, type TodoActor } from '../todo-orchestration';

/**
 * Postgres-backed `ApprovalGate` adapter.
 *
 * Lot 3 contract: every method delegates to the existing
 * `gate-service.ts` exports. No logic moved.
 *
 * `signal()` is the only method without a 1:1 existing equivalent.
 * It re-uses `todoOrchestrationService.resumeRun` semantics today.
 * The `decision` parameter is currently advisory (Lot 4 will lock the
 * gate-aware path). The constructor accepts an optional system actor
 * factory because `resumeRun` requires a `TodoActor` context; the
 * default uses a system actor placeholder for non-user-driven signals.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3.
 */
export class PostgresApprovalGate implements ApprovalGate<WorkspaceType> {
  /**
   * Optional factory to translate a runId into the actor context
   * `resumeRun` requires. When omitted, `signal()` will throw —
   * callers that already hold a `TodoActor` should call
   * `todoOrchestrationService.resumeRun` directly until Lot 4 locks
   * the gate-aware boundary.
   */
  constructor(private readonly resolveActor?: (runId: string) => Promise<TodoActor>) {}

  resolveConfig(workspaceId: string): Promise<GateConfig | null> {
    return resolveGateConfig(workspaceId) as Promise<GateConfig | null>;
  }

  getDefaultConfig(type: WorkspaceType): GateConfig | null {
    return getDefaultGateConfig(type) as GateConfig | null;
  }

  evaluate(
    workspaceId: string,
    entityId: string,
    targetStage: string,
  ): Promise<GateEvaluationResult> {
    return evaluateGate(workspaceId, entityId, targetStage);
  }

  async signal(runId: string, _decision: GateDecision): Promise<void> {
    if (!this.resolveActor) {
      throw new Error(
        '[PostgresApprovalGate.signal] no actor resolver wired; pass `resolveActor` ' +
          'to the constructor or call `todoOrchestrationService.resumeRun` directly.',
      );
    }
    const actor = await this.resolveActor(runId);
    await todoOrchestrationService.resumeRun(actor, runId);
  }
}

/**
 * Default singleton instance with no actor resolver. Lot 4 will wire
 * the resolver from the route handler that owns the gate signal HTTP
 * surface (under `BR26-EX3`).
 */
export const postgresApprovalGate = new PostgresApprovalGate();
