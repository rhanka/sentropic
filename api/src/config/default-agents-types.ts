/**
 * Shared type for agent definitions across all split agent files.
 * Extracted to avoid circular dependencies between default-agents.ts and split files.
 */
export type DefaultGenerationAgentDefinition = {
  key: string;
  name: string;
  description: string;
  sourceLevel: "code";
  config: Record<string, unknown>;
};
