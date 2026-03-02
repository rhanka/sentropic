import { defaultPrompts } from "./default-prompts";
import type {
  GenerationAgentKey,
  UseCaseGenerationWorkflowTaskKey,
} from "./default-workflows";

const readLegacyPromptTemplate = (promptId: string): string => {
  const prompt = defaultPrompts.find((item) => item.id === promptId);
  return typeof prompt?.content === "string" ? prompt.content : "";
};

export type DefaultGenerationAgentDefinition = {
  key: GenerationAgentKey;
  name: string;
  description: string;
  sourceLevel: "code";
  config: Record<string, unknown>;
};

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

export const DEFAULT_GENERATION_AGENT_BY_KEY = new Map<
  GenerationAgentKey,
  DefaultGenerationAgentDefinition
>(DEFAULT_GENERATION_AGENTS.map((item) => [item.key, item]));

export const DEFAULT_GENERATION_AGENT_KEY_BY_TASK: Record<
  UseCaseGenerationWorkflowTaskKey,
  GenerationAgentKey
> = {
  generation_context_prepare: "generation_orchestrator",
  generation_matrix_prepare: "matrix_generation_agent",
  generation_usecase_list: "usecase_list_agent",
  generation_todo_sync: "todo_projection_agent",
  generation_usecase_detail: "usecase_detail_agent",
  generation_executive_summary: "executive_synthesis_agent",
};
