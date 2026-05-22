import type {
  AgentTemplate,
  ResolvedAgentConfig,
} from '@sentropic/flow';
import {
  todoOrchestrationService,
  type TodoActor,
} from '../todo-orchestration';

type AgentConfigUpsertItem = Parameters<
  typeof todoOrchestrationService.putAgentConfigs
>[1][number];

type AgentForkInput = Parameters<
  typeof todoOrchestrationService.forkAgentConfig
>[2];

type AgentConfigRow = Awaited<
  ReturnType<typeof todoOrchestrationService.putAgentConfigs>
>[number];

/**
 * Postgres-backed `AgentTemplate` adapter.
 *
 * Lot 3 contract: CRUD methods delegate to the matching public
 * methods of `todoOrchestrationService`. The `resolve()` method has
 * no public delegate today — `resolveWorkflowTasksWithAgents` and
 * `buildAgentMap` are private and currently called inline from
 * `startWorkflow`. They will be exposed via this port at Lot 8 when
 * the orchestration loop moves into the package. Until then,
 * `resolve()` throws so accidental callers stay loud.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 and §6 (agent templating
 * invariant — same `agentId + state` must yield the same config
 * before and after each slice).
 */
export class PostgresAgentTemplate
  implements
    AgentTemplate<
      TodoActor,
      AgentConfigRow,
      AgentConfigUpsertItem,
      AgentForkInput,
      string,
      unknown
    >
{
  list(actor: TodoActor): Promise<AgentConfigRow[]> {
    return todoOrchestrationService.listAgentConfigs(actor) as Promise<
      AgentConfigRow[]
    >;
  }

  upsertMany(
    actor: TodoActor,
    items: AgentConfigUpsertItem[],
  ): Promise<AgentConfigRow[]> {
    return todoOrchestrationService.putAgentConfigs(actor, items) as Promise<
      AgentConfigRow[]
    >;
  }

  fork(
    actor: TodoActor,
    id: string,
    input: AgentForkInput,
  ): Promise<AgentConfigRow> {
    return todoOrchestrationService.forkAgentConfig(actor, id, input) as Promise<
      AgentConfigRow
    >;
  }

  detach(actor: TodoActor, id: string): Promise<AgentConfigRow> {
    return todoOrchestrationService.detachAgentConfig(actor, id) as Promise<
      AgentConfigRow
    >;
  }

  reset(actor: TodoActor, id: string): Promise<AgentConfigRow> {
    return todoOrchestrationService.resetAgentConfig(actor, id) as Promise<
      AgentConfigRow
    >;
  }

  async delete(actor: TodoActor, id: string): Promise<void> {
    await todoOrchestrationService.deleteAgentConfig(actor, id);
  }

  async seedForWorkspaceType(actor: TodoActor, type: string): Promise<void> {
    // The current `seedAgentsForType` returns a Record (agent id by key)
    // because callers (eg. `seedWorkflowsForType`) need the mapping
    // back. The port-level signature is fire-and-forget; consumers that
    // need the mapping must keep calling `todoOrchestrationService`
    // directly until Lot 5 lifts the seed catalog into `packages/flow`.
    const seed = (await import('../../config/default-agents')).getAgentSeedsForType(type);
    if (!seed) return;
    await todoOrchestrationService.seedAgentsForType(actor, seed.agents);
  }

  resolve(
    _agentId: string,
    _contextVars: Record<string, unknown>,
    _attachedSkills?: string[],
    _authz?: unknown,
  ): Promise<ResolvedAgentConfig> {
    throw new Error(
      '[PostgresAgentTemplate.resolve] not yet wired — pending Lot 8 ' +
        '(resolveWorkflowTasksWithAgents + buildAgentMap are currently ' +
        'private to TodoOrchestrationService.startWorkflow).',
    );
  }
}

export const postgresAgentTemplate = new PostgresAgentTemplate();
