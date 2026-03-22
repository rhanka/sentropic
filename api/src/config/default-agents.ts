/**
 * Multi-agent seed data per workspace type (§8.1).
 *
 * Open runtime types: agent keys are free strings (§7.3).
 * Legacy type imports kept as string aliases for backward compatibility.
 */

import { AI_IDEAS_AGENTS } from './default-agents-ai-ideas';
import { OPPORTUNITY_AGENTS } from './default-agents-opportunity';
import { CODE_AGENTS } from './default-agents-code';
import { SHARED_AGENTS } from './default-agents-shared';

export type { DefaultGenerationAgentDefinition } from './default-agents-types';
import type { DefaultGenerationAgentDefinition } from './default-agents-types';

// ---------------------------------------------------------------------------
// Backward-compat: keep DEFAULT_GENERATION_AGENTS pointing to AI-Ideas agents
// ---------------------------------------------------------------------------

export const DEFAULT_GENERATION_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = AI_IDEAS_AGENTS;

// Re-export split catalogs for direct consumers
export { AI_IDEAS_AGENTS } from './default-agents-ai-ideas';
export { OPPORTUNITY_AGENTS } from './default-agents-opportunity';
export { CODE_AGENTS } from './default-agents-code';
export { SHARED_AGENTS } from './default-agents-shared';

// ---------------------------------------------------------------------------
// Workspace type → agent catalog (with shared agents for all types)
// ---------------------------------------------------------------------------

export type WorkspaceTypeAgentSeed = {
  workspaceType: string;
  agents: ReadonlyArray<DefaultGenerationAgentDefinition>;
};

export const WORKSPACE_TYPE_AGENT_SEEDS: ReadonlyArray<WorkspaceTypeAgentSeed> = [
  { workspaceType: "ai-ideas", agents: [...AI_IDEAS_AGENTS, ...SHARED_AGENTS] },
  { workspaceType: "opportunity", agents: [...OPPORTUNITY_AGENTS, ...SHARED_AGENTS] },
  { workspaceType: "code", agents: [...CODE_AGENTS, ...SHARED_AGENTS] },
  // neutral: no generation agents (orchestrator tools only, §8.2)
];

/** Look up the agent seed catalog for a workspace type. Returns undefined for neutral. */
export function getAgentSeedsForType(workspaceType: string): WorkspaceTypeAgentSeed | undefined {
  return WORKSPACE_TYPE_AGENT_SEEDS.find((s) => s.workspaceType === workspaceType);
}

// ---------------------------------------------------------------------------
// Backward-compat exports
// ---------------------------------------------------------------------------

export const DEFAULT_GENERATION_AGENT_BY_KEY = new Map<
  string,
  DefaultGenerationAgentDefinition
>(DEFAULT_GENERATION_AGENTS.map((item) => [item.key, item]));

/**
 * Legacy task-key → agent-key mapping for ai-ideas workflow.
 * @deprecated Use runtime lookup from workflow_definition_tasks.agentDefinitionId instead (§7.3).
 */
export const DEFAULT_GENERATION_AGENT_KEY_BY_TASK: Record<string, string> = {
  generation_context_prepare: "generation_orchestrator",
  generation_matrix_prepare: "matrix_generation_agent",
  generation_usecase_list: "usecase_list_agent",
  generation_todo_sync: "todo_projection_agent",
  generation_usecase_detail: "usecase_detail_agent",
  generation_executive_summary: "executive_synthesis_agent",
};
