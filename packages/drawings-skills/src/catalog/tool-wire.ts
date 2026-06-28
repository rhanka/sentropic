import type { DrawingTool, JsonObjectSchema } from './types';

/**
 * The wire shape accepted by chat-core `local_tool_definitions` / llm-mesh function tools:
 * `parameters` (NOT `inputSchema`), and NO app-only `execution` field.
 */
export interface FunctionToolDefinition {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
}

/** Strip app metadata (`execution`) so the provider only sees the wire schema. */
export function toFunctionToolDefinition(tool: DrawingTool): FunctionToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
