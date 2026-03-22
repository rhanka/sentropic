/**
 * Code workspace agents (existing 3 agents, unchanged).
 */
import type { DefaultGenerationAgentDefinition } from './default-agents-types';

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
