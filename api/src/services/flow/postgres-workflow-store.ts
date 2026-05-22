import type { WorkflowStore } from '@sentropic/flow';
import {
  todoOrchestrationService,
  type TodoActor,
} from '../todo-orchestration';

/**
 * App-side types preserved verbatim from `todo-orchestration.ts`:
 * the façade does not narrow them so that the Lot 3 delegation is
 * 100% behavior-preserving (no schema/normalization drift).
 */
type WorkflowConfigUpsertItem = Parameters<
  typeof todoOrchestrationService.putWorkflowConfigs
>[1][number];

type WorkflowForkInput = Parameters<
  typeof todoOrchestrationService.forkWorkflowConfig
>[2];

type WorkflowConfigRow = Awaited<
  ReturnType<typeof todoOrchestrationService.putWorkflowConfigs>
>[number];

/**
 * Postgres-backed `WorkflowStore` adapter.
 *
 * Lot 3 contract: every method delegates to the matching public
 * method of `todoOrchestrationService`. No logic moved.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3.
 */
export class PostgresWorkflowStore
  implements
    WorkflowStore<
      TodoActor,
      WorkflowConfigRow,
      WorkflowConfigUpsertItem,
      WorkflowForkInput,
      string
    >
{
  list(actor: TodoActor): Promise<WorkflowConfigRow[]> {
    return todoOrchestrationService.listWorkflowConfigs(actor) as Promise<
      WorkflowConfigRow[]
    >;
  }

  upsertMany(
    actor: TodoActor,
    items: WorkflowConfigUpsertItem[],
  ): Promise<WorkflowConfigRow[]> {
    return todoOrchestrationService.putWorkflowConfigs(actor, items) as Promise<
      WorkflowConfigRow[]
    >;
  }

  fork(
    actor: TodoActor,
    id: string,
    input: WorkflowForkInput,
  ): Promise<WorkflowConfigRow> {
    return todoOrchestrationService.forkWorkflowConfig(actor, id, input) as Promise<
      WorkflowConfigRow
    >;
  }

  detach(actor: TodoActor, id: string): Promise<WorkflowConfigRow> {
    return todoOrchestrationService.detachWorkflowConfig(actor, id) as Promise<
      WorkflowConfigRow
    >;
  }

  reset(actor: TodoActor, id: string): Promise<WorkflowConfigRow> {
    return todoOrchestrationService.resetWorkflowConfig(actor, id) as Promise<
      WorkflowConfigRow
    >;
  }

  async delete(actor: TodoActor, id: string): Promise<void> {
    await todoOrchestrationService.deleteWorkflowConfig(actor, id);
  }

  seedForWorkspaceType(actor: TodoActor, type: string): Promise<void> {
    return todoOrchestrationService.seedWorkflowsForType(actor, type);
  }
}

export const postgresWorkflowStore = new PostgresWorkflowStore();
