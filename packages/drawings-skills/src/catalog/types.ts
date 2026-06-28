// Catalog contracts — a format = skill + tool + agent + canvas capabilities.
// Shaped toward the sentropic BR-42b CatalogSource (skills+tools+agents+canvas).
import type { CanvasCapabilities, DrawingFormatId, RendererPort } from '../canvas/types';

export type JsonObjectSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export interface DrawingSkill {
  formatId: DrawingFormatId;
  name: string;
  description: string;
  /** System prompt teaching an LLM to emit valid source for this format. */
  systemPrompt: string;
  examples?: Array<{ prompt: string; source: string }>;
  /** Canonical validation (async — e.g. mermaid.parse). */
  validate(source: string): Promise<ValidationResult>;
}

/**
 * App-side tool metadata. NOTE: the chat-core / llm-mesh WIRE tool definition uses
 * `parameters` and has NO `execution` field — strip app metadata via
 * `toFunctionToolDefinition()` (catalog/tool-wire.ts) before sending to a provider.
 */
export interface DrawingTool {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
  /** 'local' = executed client-side (writes the canvas); 'server' = executed by the API. */
  execution: 'local' | 'server';
}

export interface DrawingAgent {
  formatId: DrawingFormatId;
  run(input: { prompt: string; currentSource?: string }): Promise<{ source: string }>;
}

export interface DrawingFormat {
  id: DrawingFormatId;
  label: string;
  fileExtension: string;
  capabilities: CanvasCapabilities;
  skill: DrawingSkill;
  tool: DrawingTool;
  agent: DrawingAgent;
  createRenderer(): RendererPort;
}

export interface DrawingRegistry {
  register(format: DrawingFormat): void;
  list(): DrawingFormat[];
  get(id: DrawingFormatId): DrawingFormat | undefined;
  getTool(id: DrawingFormatId): DrawingTool | undefined;
  getSkill(id: DrawingFormatId): DrawingSkill | undefined;
}
