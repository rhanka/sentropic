/**
 * Opportunity workspace agents.
 * Real prompts to be drafted in Lot 9ter.
 */
import type { DefaultGenerationAgentDefinition } from './default-agents-types';

const NEUTRAL_PLACEHOLDER = '[NEUTRAL PROMPT PLACEHOLDER - to be drafted in Lot 9ter]';

export const OPPORTUNITY_AGENTS: ReadonlyArray<DefaultGenerationAgentDefinition> = [
  {
    key: "opportunity_orchestrator",
    name: "Opportunity orchestrator",
    description:
      "Orchestrates opportunity generation lifecycle and runtime context handoff.",
    sourceLevel: "code",
    config: {
      role: "orchestrator",
      workflowKey: "opportunity_generation_v1",
    },
  },
  {
    key: "matrix_generation_agent",
    name: "Matrix generation agent",
    description:
      "Generates organization-specific matrix descriptions for opportunity scoring.",
    sourceLevel: "code",
    config: {
      role: "matrix_generation",
      promptId: "opportunity_matrix_template",
      promptTemplate: NEUTRAL_PLACEHOLDER,
    },
  },
  {
    key: "opportunity_list_agent",
    name: "Opportunity list agent",
    description:
      "Generates a structured list of candidate opportunities from folder context.",
    sourceLevel: "code",
    config: {
      role: "opportunity_list_generation",
      promptId: "opportunity_list",
      promptTemplate: NEUTRAL_PLACEHOLDER,
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
    key: "opportunity_detail_agent",
    name: "Opportunity detail agent",
    description:
      "Generates one detailed opportunity payload with validated score blocks.",
    sourceLevel: "code",
    config: {
      role: "opportunity_detail_generation",
      promptId: "opportunity_detail",
      promptTemplate: NEUTRAL_PLACEHOLDER,
    },
  },
  {
    key: "executive_synthesis_agent",
    name: "Executive synthesis agent",
    description:
      "Generates executive summary narrative and prioritization synthesis for opportunities.",
    sourceLevel: "code",
    config: {
      role: "executive_summary_generation",
      promptId: "opportunity_executive_summary",
      promptTemplate: NEUTRAL_PLACEHOLDER,
    },
  },
];
