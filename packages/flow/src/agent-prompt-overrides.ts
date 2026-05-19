/**
 * @sentropic/flow — pure helper to read a generation prompt override
 * out of an `agentDefinitions.config` record.
 *
 * Real reorganization (BR-26 Lot 7): used to live as
 * `resolveGenerationPromptOverrideFromConfig` (top-level export of
 * `api/src/services/queue-manager.ts`). Pure — no DB, no I/O —
 * belongs with the `AgentTemplate` port concept (see
 * `./agent-template.ts`).
 *
 * The shape expected on the agent config object:
 *   - `promptId?: string` — override prompt id (falls back to caller-provided default)
 *   - `promptTemplate?: string` — inline override template
 *   - `outputSchema?: Record<string, unknown>` — schema override
 */

export interface GenerationPromptOverride {
  promptId: string;
  promptTemplate?: string;
  outputSchema?: Record<string, unknown>;
}

export function resolveGenerationPromptOverrideFromConfig(
  rawConfig: unknown,
  fallbackPromptId: string,
): GenerationPromptOverride {
  const config =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};
  const promptId =
    typeof config.promptId === 'string' && config.promptId.trim().length > 0
      ? config.promptId.trim()
      : fallbackPromptId;
  const promptTemplate =
    typeof config.promptTemplate === 'string' && config.promptTemplate.trim().length > 0
      ? config.promptTemplate
      : undefined;
  const outputSchema =
    config.outputSchema &&
    typeof config.outputSchema === 'object' &&
    !Array.isArray(config.outputSchema)
      ? (config.outputSchema as Record<string, unknown>)
      : undefined;
  return { promptId, promptTemplate, outputSchema };
}
