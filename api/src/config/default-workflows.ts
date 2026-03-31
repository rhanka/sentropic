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
  schemaFormat?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  sectionKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type DefaultWorkflowTransitionDefinition = {
  fromTaskKey?: string | null;
  toTaskKey?: string | null;
  transitionType: "start" | "normal" | "conditional" | "fanout" | "join" | "end";
  condition?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type DefaultWorkflowDefinition = {
  key: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  tasks: ReadonlyArray<DefaultWorkflowTaskDefinition>;
  transitions: ReadonlyArray<DefaultWorkflowTransitionDefinition>;
};

/** Workspace-type-specific workflow seed catalog (§7.6) */
export type WorkspaceTypeWorkflowSeed = {
  workspaceType: string;
  workflows: ReadonlyArray<DefaultWorkflowDefinition>;
  /** Key of the default workflow for this type */
  defaultWorkflowKey: string;
};

const jobTaskMetadata = (
  jobType: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  executor: "job",
  jobType,
  ...extra,
});

const noopTaskMetadata = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  executor: "noop",
  ...extra,
});

const conditionEq = (path: string, value: unknown): Record<string, unknown> => ({
  path,
  operator: "eq",
  value,
});

const conditionNotEmpty = (path: string): Record<string, unknown> => ({
  path,
  operator: "not_empty",
});

const allOf = (...conditions: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> => ({
  all: conditions,
});

const anyOf = (...conditions: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> => ({
  any: conditions,
});

const notOf = (condition: Record<string, unknown>): Record<string, unknown> => ({
  not: condition,
});

const matrixPreparationRequiredCondition = anyOf(
  conditionEq("inputs.matrixSource", "prompt"),
  allOf(
    conditionEq("inputs.matrixSource", null),
    conditionEq("inputs.matrixMode", "generate"),
  ),
);

const matrixBarrierJoinMetadata = (taskKeys: readonly string[]): Record<string, unknown> => ({
  join: {
    mode: "all_main",
    requiredTaskKeys: taskKeys,
  },
});

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
      taskKey: "generation_create_organizations",
      title: "Organization batch creation",
      description:
        "Auto-create organizations from user prompt before use-case generation. Skipped when autoCreateOrganizations is false.",
      orderIndex: 0,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_batch_create", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "generation_organization_enrich",
      title: "Organization create or enrich",
      description:
        "Resolve one organization candidate into a visible queue job and enrich it when needed.",
      orderIndex: 1,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_enrich", {
        inputBindings: {
          organizationId: "$item.organizationId",
          organizationName: "$item.organizationName",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
          skipIfCompleted: "$item.skipIfCompleted",
          wasCreated: "$item.wasCreated",
        },
      }),
    },
    {
      taskKey: "generation_organization_join",
      title: "Organization resolution join",
      description:
        "Join resolved organizations back into workflow state before downstream generation.",
      orderIndex: 2,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_targets_join", {
        inputBindings: {
          sourceTaskKey: "generation_organization_enrich",
        },
      }),
    },
    {
      taskKey: "generation_context_prepare",
      title: "Generation context preparation",
      description:
        "Normalize request payload and folder context before generation runtime starts.",
      orderIndex: 3,
      agentKey: "generation_orchestrator",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "generation_matrix_prepare",
      title: "Matrix preparation",
      description:
        "Generate matrix configuration when matrix mode requires dynamic generation.",
      orderIndex: 4,
      agentKey: "matrix_generation_agent",
      metadata: jobTaskMetadata("matrix_generate", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          organizationId: "$state.inputs.organizationId",
          orgIds: "$state.orgContext.effectiveOrgIds",
          matrixSource: "$state.inputs.matrixSource",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "generation_usecase_list",
      title: "Use-case list generation",
      description: "Generate draft use-case list from normalized context.",
      orderIndex: 5,
      agentKey: "usecase_list_agent",
      metadata: jobTaskMetadata("initiative_list", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          organizationId: "$state.inputs.organizationId",
          matrixMode: "$state.inputs.matrixMode",
          model: "$state.inputs.model",
          initiativeCount: "$state.inputs.initiativeCount",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
          orgIds: "$state.orgContext.effectiveOrgIds",
        },
        agentSelection: {
          defaultAgentKey: "usecase_list_agent",
          rules: [
            {
              condition: anyOf(
                conditionEq("inputs.autoCreateOrganizations", true),
                conditionNotEmpty("orgContext.effectiveOrgIds"),
                conditionNotEmpty("orgContext.selectedOrgIds"),
              ),
              agentKey: "usecase_list_with_orgs_agent",
            },
          ],
        },
      }),
    },
    {
      taskKey: "generation_todo_sync",
      title: "TODO synchronization",
      description:
        "Synchronize generated items with chat session TODO runtime projection.",
      orderIndex: 6,
      agentKey: "todo_projection_agent",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "generation_usecase_detail",
      title: "Use-case detail generation",
      description: "Generate detail payload for each draft use case.",
      orderIndex: 7,
      agentKey: "usecase_detail_agent",
      metadata: jobTaskMetadata("initiative_detail", {
        inputBindings: {
          initiativeId: "$item.id",
          initiativeName: "$item.name",
          folderId: "$state.inputs.folderId",
          matrixMode: "$state.inputs.matrixMode",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "generation_executive_summary",
      title: "Executive synthesis generation",
      description:
        "Generate executive summary once all use cases are completed.",
      orderIndex: 8,
      agentKey: "executive_synthesis_agent",
      metadata: jobTaskMetadata("executive_summary", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
  ],
  transitions: [
    {
      fromTaskKey: null,
      toTaskKey: "generation_context_prepare",
      transitionType: "start",
    },
    {
      fromTaskKey: "generation_context_prepare",
      toTaskKey: "generation_matrix_prepare",
      transitionType: "conditional",
      condition: allOf(conditionEq("inputs.autoCreateOrganizations", false), matrixPreparationRequiredCondition),
    },
    {
      fromTaskKey: "generation_context_prepare",
      toTaskKey: "generation_usecase_list",
      transitionType: "normal",
    },
    {
      fromTaskKey: "generation_usecase_list",
      toTaskKey: "generation_create_organizations",
      transitionType: "conditional",
      condition: conditionEq("inputs.autoCreateOrganizations", true),
    },
    {
      fromTaskKey: "generation_create_organizations",
      toTaskKey: "generation_organization_enrich",
      transitionType: "fanout",
      metadata: {
        fanout: {
          sourcePath: "orgContext.organizationTargets",
          itemKey: "organizationTarget",
          instanceKeyPath: "organizationId",
        },
      },
    },
    {
      fromTaskKey: "generation_organization_enrich",
      toTaskKey: "generation_organization_join",
      transitionType: "join",
      metadata: {
        join: {
          taskKey: "generation_organization_enrich",
          mode: "all",
          expectedSourcePath: "orgContext.organizationTargets",
        },
      },
    },
    {
      fromTaskKey: "generation_usecase_list",
      toTaskKey: "generation_todo_sync",
      transitionType: "conditional",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        notOf(matrixPreparationRequiredCondition),
      ),
    },
    {
      fromTaskKey: "generation_usecase_list",
      toTaskKey: "generation_todo_sync",
      transitionType: "join",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        matrixPreparationRequiredCondition,
      ),
      metadata: matrixBarrierJoinMetadata(["generation_usecase_list", "generation_matrix_prepare"]),
    },
    {
      fromTaskKey: "generation_organization_join",
      toTaskKey: "generation_matrix_prepare",
      transitionType: "conditional",
      condition: matrixPreparationRequiredCondition,
    },
    {
      fromTaskKey: "generation_organization_join",
      toTaskKey: "generation_todo_sync",
      transitionType: "conditional",
      condition: notOf(matrixPreparationRequiredCondition),
    },
    {
      fromTaskKey: "generation_matrix_prepare",
      toTaskKey: "generation_todo_sync",
      transitionType: "conditional",
      condition: conditionEq("inputs.autoCreateOrganizations", true),
    },
    {
      fromTaskKey: "generation_matrix_prepare",
      toTaskKey: "generation_todo_sync",
      transitionType: "join",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        matrixPreparationRequiredCondition,
      ),
      metadata: matrixBarrierJoinMetadata(["generation_usecase_list", "generation_matrix_prepare"]),
    },
    {
      fromTaskKey: "generation_todo_sync",
      toTaskKey: "generation_usecase_detail",
      transitionType: "fanout",
      metadata: {
        fanout: {
          sourcePath: "generation.initiatives",
          itemKey: "initiative",
        },
      },
    },
    {
      fromTaskKey: "generation_usecase_detail",
      toTaskKey: "generation_executive_summary",
      transitionType: "join",
      metadata: {
        join: {
          taskKey: "generation_usecase_detail",
          mode: "all",
          expectedSourcePath: "generation.initiatives",
        },
      },
    },
    {
      fromTaskKey: "generation_executive_summary",
      toTaskKey: null,
      transitionType: "end",
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
      taskKey: "create_organizations",
      title: "Organization batch creation",
      description: "Auto-create organizations from user prompt before opportunity identification. Skipped when autoCreateOrganizations is false.",
      orderIndex: 0,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_batch_create", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "organization_enrich",
      title: "Organization create or enrich",
      description: "Resolve one organization candidate into a visible queue job and enrich it when needed.",
      orderIndex: 1,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_enrich", {
        inputBindings: {
          organizationId: "$item.organizationId",
          organizationName: "$item.organizationName",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
          skipIfCompleted: "$item.skipIfCompleted",
          wasCreated: "$item.wasCreated",
        },
      }),
    },
    {
      taskKey: "organization_targets_join",
      title: "Organization resolution join",
      description: "Join resolved organizations back into workflow state before downstream generation.",
      orderIndex: 2,
      agentKey: "organization_batch_agent",
      metadata: jobTaskMetadata("organization_targets_join", {
        inputBindings: {
          sourceTaskKey: "organization_enrich",
        },
      }),
    },
    {
      taskKey: "context_prepare",
      title: "Context preparation",
      description: "Normalize request payload and organization context before opportunity identification.",
      orderIndex: 3,
      agentKey: "opportunity_orchestrator",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "matrix_prepare",
      title: "Matrix preparation",
      description: "Generate matrix configuration when matrix mode requires dynamic generation.",
      orderIndex: 4,
      agentKey: "matrix_generation_agent",
      metadata: jobTaskMetadata("matrix_generate", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          organizationId: "$state.inputs.organizationId",
          orgIds: "$state.orgContext.effectiveOrgIds",
          matrixSource: "$state.inputs.matrixSource",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "opportunity_list",
      title: "Opportunity list generation",
      description: "Generate draft opportunity list from normalized context.",
      orderIndex: 5,
      agentKey: "opportunity_list_agent",
      metadata: jobTaskMetadata("initiative_list", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          input: "$state.inputs.input",
          organizationId: "$state.inputs.organizationId",
          matrixMode: "$state.inputs.matrixMode",
          model: "$state.inputs.model",
          initiativeCount: "$state.inputs.initiativeCount",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
          orgIds: "$state.orgContext.effectiveOrgIds",
        },
        agentSelection: {
          defaultAgentKey: "opportunity_list_agent",
          rules: [
            {
              condition: anyOf(
                conditionEq("inputs.autoCreateOrganizations", true),
                conditionNotEmpty("orgContext.effectiveOrgIds"),
                conditionNotEmpty("orgContext.selectedOrgIds"),
              ),
              agentKey: "opportunity_list_with_orgs_agent",
            },
          ],
        },
      }),
    },
    {
      taskKey: "todo_sync",
      title: "TODO synchronization",
      description: "Synchronize generated items with chat session TODO runtime projection.",
      orderIndex: 6,
      agentKey: "todo_projection_agent",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "opportunity_detail",
      title: "Opportunity detail generation",
      description: "Generate detail payload for each draft opportunity.",
      orderIndex: 7,
      agentKey: "opportunity_detail_agent",
      metadata: jobTaskMetadata("initiative_detail", {
        inputBindings: {
          initiativeId: "$item.id",
          initiativeName: "$item.name",
          folderId: "$state.inputs.folderId",
          matrixMode: "$state.inputs.matrixMode",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
    {
      taskKey: "executive_summary",
      title: "Executive synthesis generation",
      description: "Generate executive summary once all opportunities are completed.",
      orderIndex: 8,
      agentKey: "executive_synthesis_agent",
      metadata: jobTaskMetadata("executive_summary", {
        inputBindings: {
          folderId: "$state.inputs.folderId",
          model: "$state.inputs.model",
          initiatedByUserId: "$run.startedByUserId",
          locale: "$state.inputs.locale",
        },
      }),
    },
  ],
  transitions: [
    {
      fromTaskKey: null,
      toTaskKey: "context_prepare",
      transitionType: "start",
    },
    {
      fromTaskKey: "context_prepare",
      toTaskKey: "matrix_prepare",
      transitionType: "conditional",
      condition: allOf(conditionEq("inputs.autoCreateOrganizations", false), matrixPreparationRequiredCondition),
    },
    {
      fromTaskKey: "context_prepare",
      toTaskKey: "opportunity_list",
      transitionType: "normal",
    },
    {
      fromTaskKey: "opportunity_list",
      toTaskKey: "create_organizations",
      transitionType: "conditional",
      condition: conditionEq("inputs.autoCreateOrganizations", true),
    },
    {
      fromTaskKey: "create_organizations",
      toTaskKey: "organization_enrich",
      transitionType: "fanout",
      metadata: {
        fanout: {
          sourcePath: "orgContext.organizationTargets",
          itemKey: "organizationTarget",
          instanceKeyPath: "organizationId",
        },
      },
    },
    {
      fromTaskKey: "organization_enrich",
      toTaskKey: "organization_targets_join",
      transitionType: "join",
      metadata: {
        join: {
          taskKey: "organization_enrich",
          mode: "all",
          expectedSourcePath: "orgContext.organizationTargets",
        },
      },
    },
    {
      fromTaskKey: "opportunity_list",
      toTaskKey: "todo_sync",
      transitionType: "conditional",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        notOf(matrixPreparationRequiredCondition),
      ),
    },
    {
      fromTaskKey: "opportunity_list",
      toTaskKey: "todo_sync",
      transitionType: "join",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        matrixPreparationRequiredCondition,
      ),
      metadata: matrixBarrierJoinMetadata(["opportunity_list", "matrix_prepare"]),
    },
    {
      fromTaskKey: "organization_targets_join",
      toTaskKey: "matrix_prepare",
      transitionType: "conditional",
      condition: matrixPreparationRequiredCondition,
    },
    {
      fromTaskKey: "organization_targets_join",
      toTaskKey: "todo_sync",
      transitionType: "conditional",
      condition: notOf(matrixPreparationRequiredCondition),
    },
    {
      fromTaskKey: "matrix_prepare",
      toTaskKey: "todo_sync",
      transitionType: "conditional",
      condition: conditionEq("inputs.autoCreateOrganizations", true),
    },
    {
      fromTaskKey: "matrix_prepare",
      toTaskKey: "todo_sync",
      transitionType: "join",
      condition: allOf(
        conditionEq("inputs.autoCreateOrganizations", false),
        matrixPreparationRequiredCondition,
      ),
      metadata: matrixBarrierJoinMetadata(["opportunity_list", "matrix_prepare"]),
    },
    {
      fromTaskKey: "todo_sync",
      toTaskKey: "opportunity_detail",
      transitionType: "fanout",
      metadata: {
        fanout: {
          sourcePath: "generation.initiatives",
          itemKey: "initiative",
        },
      },
    },
    {
      fromTaskKey: "opportunity_detail",
      toTaskKey: "executive_summary",
      transitionType: "join",
      metadata: {
        join: {
          taskKey: "opportunity_detail",
          mode: "all",
          expectedSourcePath: "generation.initiatives",
        },
      },
    },
    {
      fromTaskKey: "executive_summary",
      toTaskKey: null,
      transitionType: "end",
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
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "demand_analysis",
      title: "Demand analysis",
      description: "Analyze client demand and market context to assess opportunity viability.",
      orderIndex: 1,
      agentKey: "demand_analyst",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "solution_draft",
      title: "Solution draft",
      description: "Draft initial solution architecture based on demand analysis.",
      orderIndex: 2,
      agentKey: "solution_architect",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "bid_preparation",
      title: "Bid preparation",
      description: "Prepare bid document from solution draft and commercial terms.",
      orderIndex: 3,
      agentKey: "bid_writer",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "gate_review",
      title: "Gate review",
      description: "Evaluate initiative maturity against gate criteria.",
      orderIndex: 4,
      agentKey: "gate_reviewer",
      metadata: noopTaskMetadata(),
    },
  ],
  transitions: [
    { fromTaskKey: null, toTaskKey: "context_prepare", transitionType: "start" },
    { fromTaskKey: "context_prepare", toTaskKey: "demand_analysis", transitionType: "normal" },
    { fromTaskKey: "demand_analysis", toTaskKey: "solution_draft", transitionType: "normal" },
    { fromTaskKey: "solution_draft", toTaskKey: "bid_preparation", transitionType: "normal" },
    { fromTaskKey: "bid_preparation", toTaskKey: "gate_review", transitionType: "normal" },
    { fromTaskKey: "gate_review", toTaskKey: null, transitionType: "end" },
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
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "codebase_scan",
      title: "Codebase scan",
      description: "Scan codebase for patterns, dependencies, and architecture.",
      orderIndex: 1,
      agentKey: "codebase_analyst",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "issue_triage",
      title: "Issue triage",
      description: "Triage and prioritize issues from codebase analysis.",
      orderIndex: 2,
      agentKey: "issue_triager",
      metadata: noopTaskMetadata(),
    },
    {
      taskKey: "implementation_plan",
      title: "Implementation plan",
      description: "Generate implementation plan from triaged issues.",
      orderIndex: 3,
      agentKey: "implementation_planner",
      metadata: noopTaskMetadata(),
    },
  ],
  transitions: [
    { fromTaskKey: null, toTaskKey: "context_prepare", transitionType: "start" },
    { fromTaskKey: "context_prepare", toTaskKey: "codebase_scan", transitionType: "normal" },
    { fromTaskKey: "codebase_scan", toTaskKey: "issue_triage", transitionType: "normal" },
    { fromTaskKey: "issue_triage", toTaskKey: "implementation_plan", transitionType: "normal" },
    { fromTaskKey: "implementation_plan", toTaskKey: null, transitionType: "end" },
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
