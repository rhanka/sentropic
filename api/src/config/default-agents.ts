/**
 * Multi-agent seed data per workspace type (§8.1).
 *
 * Open runtime types: agent keys are free strings (§7.3).
 * Legacy type imports kept as string aliases for backward compatibility.
 */

import { defaultPrompts } from "./default-prompts";

const readLegacyPromptTemplate = (promptId: string): string => {
  const prompt = defaultPrompts.find((item) => item.id === promptId);
  return typeof prompt?.content === "string" ? prompt.content : "";
};

export type DefaultGenerationAgentDefinition = {
  key: string;
  name: string;
  description: string;
  sourceLevel: "code";
  config: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// ai-ideas agents (existing 6 agents, unchanged)
// ---------------------------------------------------------------------------

export const DEFAULT_GENERATION_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "generation_orchestrator",
    name: "Generation orchestrator",
    description:
      "Orchestrates AI use-case generation lifecycle and runtime context handoff.",
    sourceLevel: "code",
    config: {
      role: "orchestrator",
      workflowKey: "ai_usecase_generation_v1",
    },
  },
  {
    key: "matrix_generation_agent",
    name: "Matrix generation agent",
    description:
      "Generates organization-specific matrix descriptions for use-case scoring.",
    sourceLevel: "code",
    config: {
      role: "matrix_generation",
      promptId: "organization_matrix_template",
      promptTemplate: readLegacyPromptTemplate("organization_matrix_template"),
    },
  },
  {
    key: "usecase_list_agent",
    name: "Use-case list agent",
    description:
      "Generates a structured list of candidate use-cases from folder context.",
    sourceLevel: "code",
    config: {
      role: "usecase_list_generation",
      promptId: "use_case_list",
      promptTemplate: readLegacyPromptTemplate("use_case_list"),
    },
  },
  {
    key: "todo_projection_agent",
    name: "TODO projection agent",
    description:
      "Projects generated list outputs to TODO runtime tracking structures.",
    sourceLevel: "code",
    config: {
      role: "todo_projection",
    },
  },
  {
    key: "usecase_detail_agent",
    name: "Use-case detail agent",
    description:
      "Generates one detailed use-case payload with validated score blocks.",
    sourceLevel: "code",
    config: {
      role: "usecase_detail_generation",
      promptId: "use_case_detail",
      promptTemplate: readLegacyPromptTemplate("use_case_detail"),
    },
  },
  {
    key: "executive_synthesis_agent",
    name: "Executive synthesis agent",
    description:
      "Generates executive summary narrative and prioritization synthesis.",
    sourceLevel: "code",
    config: {
      role: "executive_summary_generation",
      promptId: "executive_summary",
      promptTemplate: readLegacyPromptTemplate("executive_summary"),
    },
  },
];

// ---------------------------------------------------------------------------
// opportunity agents (§8.1)
// ---------------------------------------------------------------------------

export const OPPORTUNITY_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "demand_analyst",
    name: "Demand analyst",
    description: "Analyzes client demand, market context, and opportunity viability.",
    sourceLevel: "code",
    config: { role: "demand_analysis", domain: "opportunity" },
  },
  {
    key: "solution_architect",
    name: "Solution architect",
    description: "Designs solution architecture from demand analysis outputs.",
    sourceLevel: "code",
    config: { role: "solution_architecture", domain: "opportunity" },
  },
  {
    key: "bid_writer",
    name: "Bid writer",
    description: "Prepares bid documents from solution drafts and commercial terms.",
    sourceLevel: "code",
    config: { role: "bid_preparation", domain: "opportunity" },
  },
  {
    key: "gate_reviewer",
    name: "Gate reviewer",
    description: "Evaluates initiative maturity against gate criteria for stage transitions.",
    sourceLevel: "code",
    config: { role: "gate_review", domain: "opportunity" },
  },
];

// ---------------------------------------------------------------------------
// code agents (§8.1)
// ---------------------------------------------------------------------------

export const CODE_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "codebase_analyst",
    name: "Codebase analyst",
    description: "Scans codebase for patterns, dependencies, and architecture insights.",
    sourceLevel: "code",
    config: { role: "codebase_analysis", domain: "code" },
  },
  {
    key: "issue_triager",
    name: "Issue triager",
    description: "Triages and prioritizes issues from codebase analysis.",
    sourceLevel: "code",
    config: { role: "issue_triage", domain: "code" },
  },
  {
    key: "implementation_planner",
    name: "Implementation planner",
    description: "Generates implementation plans from triaged issues.",
    sourceLevel: "code",
    config: { role: "implementation_planning", domain: "code" },
  },
];

// ---------------------------------------------------------------------------
// Workspace type → agent catalog
// ---------------------------------------------------------------------------

export type WorkspaceTypeAgentSeed = {
  workspaceType: string;
  agents: ReadonlyArray<DefaultGenerationAgentDefinition>;
};

export const WORKSPACE_TYPE_AGENT_SEEDS: ReadonlyArray<WorkspaceTypeAgentSeed> = [
  { workspaceType: "ai-ideas", agents: DEFAULT_GENERATION_AGENTS },
  { workspaceType: "opportunity", agents: OPPORTUNITY_AGENTS },
  { workspaceType: "code", agents: CODE_AGENTS },
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
