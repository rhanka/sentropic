export const USE_CASE_GENERATION_WORKFLOW_KEY = "ai_usecase_generation_v1";

export type GenerationAgentKey =
  | "generation_orchestrator"
  | "matrix_generation_agent"
  | "usecase_list_agent"
  | "todo_projection_agent"
  | "usecase_detail_agent"
  | "executive_synthesis_agent";

export type UseCaseGenerationWorkflowTaskKey =
  | "generation_context_prepare"
  | "generation_matrix_prepare"
  | "generation_usecase_list"
  | "generation_todo_sync"
  | "generation_usecase_detail"
  | "generation_executive_summary";

export type DefaultWorkflowTaskDefinition = {
  taskKey: UseCaseGenerationWorkflowTaskKey;
  title: string;
  description: string;
  orderIndex: number;
  agentKey: GenerationAgentKey;
};

export type DefaultWorkflowDefinition = {
  key: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  tasks: ReadonlyArray<DefaultWorkflowTaskDefinition>;
};

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
