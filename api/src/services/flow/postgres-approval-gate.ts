import { eq } from 'drizzle-orm';
import type {
  ApprovalGate,
  GateConfig,
  GateDecision,
  GateEvaluationResult,
} from '@sentropic/flow';
import { db } from '../../db/client';
import { workspaces } from '../../db/schema';
import type { WorkspaceType } from '../workspace-access';
import { evaluateGate } from '../gate-service';
import { todoOrchestrationService, type TodoActor } from '../todo-orchestration';

// --- Default gate configs per workspace type (§6.3) ---
//
// Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §4 (Lot 4 Slice 1 Step 1 —
// moved from gate-service.ts; `gate-service.ts` now re-exports from
// here).

const DEFAULT_GATE_CONFIGS: Record<Exclude<WorkspaceType, 'neutral'>, GateConfig> = {
  'ai-ideas': {
    mode: 'free',
    stages: ['G0', 'G2'],
  },
  opportunity: {
    mode: 'soft',
    stages: ['G0', 'G2', 'G5', 'G7'],
    criteria: {
      G2: { required_fields: ['data.description', 'data.domain'], guardrail_categories: ['scope'] },
      G5: { required_fields: ['data.solution'], guardrail_categories: ['scope', 'quality'] },
      G7: { required_fields: [], guardrail_categories: ['approval'] },
    },
  },
  code: {
    mode: 'free',
    stages: ['G0', 'G2', 'G5'],
  },
};

/**
 * Returns the default gate config for a workspace type.
 * Returns null for neutral workspaces (no initiatives).
 */
export function getDefaultGateConfig(type: WorkspaceType): GateConfig | null {
  if (type === 'neutral') return null;
  return DEFAULT_GATE_CONFIGS[type] ?? null;
}

/**
 * Resolve the gate config for a workspace.
 * Uses the workspace's custom gate_config if set, otherwise falls back to the default for its type.
 */
export async function resolveGateConfig(workspaceId: string): Promise<GateConfig | null> {
  const [ws] = await db
    .select({ type: workspaces.type, gateConfig: workspaces.gateConfig })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!ws) return null;

  // Use workspace-level override if present
  if (ws.gateConfig && typeof ws.gateConfig === 'object') {
    return ws.gateConfig as unknown as GateConfig;
  }

  // Fall back to default per workspace type
  return getDefaultGateConfig(ws.type as WorkspaceType);
}

/**
 * Postgres-backed `ApprovalGate` adapter.
 *
 * Lot 4 Slice 1 Step 1: holds the canonical implementation of
 * `getDefaultConfig` / `resolveConfig`. `evaluateGate` body still
 * lives in `gate-service.ts` until Step 2.
 *
 * `signal()` re-uses `todoOrchestrationService.resumeRun` semantics
 * today (BR26-Q1: decision parameter is captured at the type level
 * but unused — see BRANCH.md Feedback Loop).
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 + §4.
 */
export class PostgresApprovalGate implements ApprovalGate<WorkspaceType> {
  /**
   * Optional factory to translate a runId into the actor context
   * `resumeRun` requires. When omitted, `signal()` will throw —
   * callers that already hold a `TodoActor` should call
   * `todoOrchestrationService.resumeRun` directly until the
   * gate-aware boundary is locked.
   */
  constructor(private readonly resolveActor?: (runId: string) => Promise<TodoActor>) {}

  resolveConfig(workspaceId: string): Promise<GateConfig | null> {
    return resolveGateConfig(workspaceId);
  }

  getDefaultConfig(type: WorkspaceType): GateConfig | null {
    return getDefaultGateConfig(type);
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
 * Default singleton instance with no actor resolver. Lot N-3 will wire
 * the resolver from the route handler that owns the gate signal HTTP
 * surface (under `BR26-EX3`).
 */
export const postgresApprovalGate = new PostgresApprovalGate();
