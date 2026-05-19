/**
 * BR14a Lot 2 — @sentropic/chat-ui renderer registry interface.
 *
 * Map-backed registry that lets app/host code register tool-result
 * renderers without forcing the package components to import
 * application-specific code. Default renderer is a JSON.stringify
 * fallback. Full `ToolResultRenderer` shape from
 * `spec/SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` lands in Lot 3+ once Svelte
 * components consume the registry.
 */

export type ToolRenderer<TInput = unknown, TOutput = unknown> = (
  input: TInput,
) => TOutput;

export interface RendererRegistry {
  register<I, O>(toolName: string, renderer: ToolRenderer<I, O>): void;
  get(toolName: string): ToolRenderer | undefined;
  default: ToolRenderer<unknown, string>;
}

const defaultJsonRenderer: ToolRenderer<unknown, string> = (input) => {
  try {
    return JSON.stringify(input ?? null);
  } catch {
    return String(input);
  }
};

export const createRendererRegistry = (): RendererRegistry => {
  const renderers = new Map<string, ToolRenderer>();
  return {
    register(toolName, renderer) {
      renderers.set(toolName, renderer as ToolRenderer);
    },
    get(toolName) {
      return renderers.get(toolName);
    },
    default: defaultJsonRenderer,
  };
};
