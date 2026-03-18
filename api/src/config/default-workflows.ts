/**
 * Multi-workflow registry seed data per workspace type (§7.3, §7.6).
 *
 * Closed compile-time types (GenerationAgentKey, InitiativeGenerationWorkflowTaskKey)
 * are replaced by open runtime strings. Type safety at service boundaries is
 * enforced via Zod validation of workflow structure, not compile-time unions.
 *
 * Legacy exports are kept as string aliases for backward compatibility with
 * existing callers that import these types.
 */

// Legacy workflow key kept for backward compat — existing DB rows use this value
export const USE_CASE_GENERATION_WORKFLOW_KEY = "ai_usecase_generation_v1";

/**
 * @deprecated Use plain `string` instead — open task-key mapping (§7.3).
 * Kept as type alias for backward compat during transition.
 */
export type GenerationAgentKey = string;

/**
 * @deprecated Use plain `string` instead — open task-key mapping (§7.3).
 * Kept as type alias for backward compat during transition.
 */
export type InitiativeGenerationWorkflowTaskKey = string;

export type DefaultWorkflowTaskDefinition = {
  taskKey: string;
  title: string;
  description: string;
  orderIndex: number;
  agentKey: string;
};

export type DefaultWorkflowDefinition = {
  key: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  tasks: ReadonlyArray<DefaultWorkflowTaskDefinition>;
};

/** Workspace-type-specific workflow seed catalog (§7.6) */
export type WorkspaceTypeWorkflowSeed = {
  workspaceType: string;
  workflows: ReadonlyArray<DefaultWorkflowDefinition>;
  /** Key of the default workflow for this type */
  defaultWorkflowKey: string;
};

// ---------------------------------------------------------------------------
// ai-ideas workflows (existing, unchanged)
// ---------------------------------------------------------------------------

export const DEFAULT_USE_CASE_GENERATION_WORKFLOW: DefaultWorkflowDefinition = {
  key: USE_CASE_GENERATION_WORKFLOW_KEY,
  name: "AI use-case generation workflow",
  description: "Workflow runtime for use-case generation requests.",
  config: {
    route: "POST /api/v1/use-cases/generate",
    migration: "lot4-runtime",
  },
  tasks: [
    {
      taskKey: "generation_context_prepare",
      title: "Generation context preparation",
      description:
        "Normalize request payload and folder context before generation runtime starts.",
      orderIndex: 0,
      agentKey: "generation_orchestrator",
    },
    {
      taskKey: "generation_matrix_prepare",
      title: "Matrix preparation",
      description:
        "Generate matrix configuration when matrix mode requires dynamic generation.",
      orderIndex: 1,
      agentKey: "matrix_generation_agent",
    },
    {
      taskKey: "generation_usecase_list",
      title: "Use-case list generation",
      description: "Generate draft use-case list from normalized context.",
      orderIndex: 2,
      agentKey: "usecase_list_agent",
    },
    {
      taskKey: "generation_todo_sync",
      title: "TODO synchronization",
      description:
        "Synchronize generated items with chat session TODO runtime projection.",
      orderIndex: 3,
      agentKey: "todo_projection_agent",
    },
    {
      taskKey: "generation_usecase_detail",
      title: "Use-case detail generation",
      description: "Generate detail payload for each draft use case.",
      orderIndex: 4,
      agentKey: "usecase_detail_agent",
    },
    {
      taskKey: "generation_executive_summary",
      title: "Executive synthesis generation",
      description:
        "Generate executive summary once all use cases are completed.",
      orderIndex: 5,
      agentKey: "executive_synthesis_agent",
    },
  ],
};

// ---------------------------------------------------------------------------
// opportunity workflows (§7.6)
// ---------------------------------------------------------------------------

export const OPPORTUNITY_IDENTIFICATION_WORKFLOW: DefaultWorkflowDefinition = {
  key: "opportunity_identification",
  name: "Opportunity identification workflow",
  description: "Workflow for identifying and prioritizing business opportunities from organization context.",
  config: {
    domain: "opportunity",
  },
  tasks: [
    {
      taskKey: "context_prepare",
      title: "Context preparation",
      description: "Normalize request payload and organization context before opportunity identification.",
      orderIndex: 0,
      agentKey: "opportunity_orchestrator",
    },
    {
      taskKey: "matrix_prepare",
      title: "Matrix preparation",
      description: "Generate matrix configuration when matrix mode requires dynamic generation.",
      orderIndex: 1,
      agentKey: "matrix_generation_agent",
    },
    {
      taskKey: "opportunity_list",
      title: "Opportunity list generation",
      description: "Generate draft opportunity list from normalized context.",
      orderIndex: 2,
      agentKey: "opportunity_list_agent",
    },
    {
      taskKey: "todo_sync",
      title: "TODO synchronization",
      description: "Synchronize generated items with chat session TODO runtime projection.",
      orderIndex: 3,
      agentKey: "todo_projection_agent",
    },
    {
      taskKey: "opportunity_detail",
      title: "Opportunity detail generation",
      description: "Generate detail payload for each draft opportunity.",
      orderIndex: 4,
      agentKey: "opportunity_detail_agent",
    },
    {
      taskKey: "executive_summary",
      title: "Executive synthesis generation",
      description: "Generate executive summary once all opportunities are completed.",
      orderIndex: 5,
      agentKey: "executive_synthesis_agent",
    },
  ],
};

export const OPPORTUNITY_QUALIFICATION_WORKFLOW: DefaultWorkflowDefinition = {
  key: "opportunity_qualification",
  name: "Opportunity qualification workflow",
  description: "Workflow for qualifying commercial opportunities through demand analysis to bid preparation.",
  config: {
    domain: "opportunity",
  },
  tasks: [
    {
      taskKey: "context_prepare",
      title: "Context preparation",
      description: "Normalize opportunity context and client data before qualification.",
      orderIndex: 0,
      agentKey: "demand_analyst",
    },
    {
      taskKey: "demand_analysis",
      title: "Demand analysis",
      description: "Analyze client demand and market context to assess opportunity viability.",
      orderIndex: 1,
      agentKey: "demand_analyst",
    },
    {
      taskKey: "solution_draft",
      title: "Solution draft",
      description: "Draft initial solution architecture based on demand analysis.",
      orderIndex: 2,
      agentKey: "solution_architect",
    },
    {
      taskKey: "bid_preparation",
      title: "Bid preparation",
      description: "Prepare bid document from solution draft and commercial terms.",
      orderIndex: 3,
      agentKey: "bid_writer",
    },
    {
      taskKey: "gate_review",
      title: "Gate review",
      description: "Evaluate initiative maturity against gate criteria.",
      orderIndex: 4,
      agentKey: "gate_reviewer",
    },
  ],
};

// ---------------------------------------------------------------------------
// code workflows (§7.6)
// ---------------------------------------------------------------------------

export const CODE_ANALYSIS_WORKFLOW: DefaultWorkflowDefinition = {
  key: "code_analysis",
  name: "Code analysis workflow",
  description: "Workflow for analyzing codebases and planning implementation.",
  config: {
    domain: "code",
  },
  tasks: [
    {
      taskKey: "context_prepare",
      title: "Context preparation",
      description: "Normalize repository context and project metadata.",
      orderIndex: 0,
      agentKey: "codebase_analyst",
    },
    {
      taskKey: "codebase_scan",
      title: "Codebase scan",
      description: "Scan codebase for patterns, dependencies, and architecture.",
      orderIndex: 1,
      agentKey: "codebase_analyst",
    },
    {
      taskKey: "issue_triage",
      title: "Issue triage",
      description: "Triage and prioritize issues from codebase analysis.",
      orderIndex: 2,
      agentKey: "issue_triager",
    },
    {
      taskKey: "implementation_plan",
      title: "Implementation plan",
      description: "Generate implementation plan from triaged issues.",
      orderIndex: 3,
      agentKey: "implementation_planner",
    },
  ],
};

// ---------------------------------------------------------------------------
// Workspace type → workflow catalog
// ---------------------------------------------------------------------------

export const WORKSPACE_TYPE_WORKFLOW_SEEDS: ReadonlyArray<WorkspaceTypeWorkflowSeed> = [
  {
    workspaceType: "ai-ideas",
    workflows: [DEFAULT_USE_CASE_GENERATION_WORKFLOW],
    defaultWorkflowKey: USE_CASE_GENERATION_WORKFLOW_KEY,
  },
  {
    workspaceType: "opportunity",
    workflows: [OPPORTUNITY_IDENTIFICATION_WORKFLOW, OPPORTUNITY_QUALIFICATION_WORKFLOW],
    defaultWorkflowKey: "opportunity_identification",
  },
  {
    workspaceType: "code",
    workflows: [CODE_ANALYSIS_WORKFLOW],
    defaultWorkflowKey: "code_analysis",
  },
  // neutral: no workflows (orchestrator only)
];

/** Look up the seed catalog for a workspace type. Returns undefined for neutral. */
export function getWorkflowSeedsForType(workspaceType: string): WorkspaceTypeWorkflowSeed | undefined {
  return WORKSPACE_TYPE_WORKFLOW_SEEDS.find((s) => s.workspaceType === workspaceType);
}
