import type { DrawingTool } from '../types';

/**
 * The diagram-writing tool. `execution: 'local'` => the server advertises its schema to the
 * LLM, but it is executed CLIENT-side (the app-owned local-tool bridge writes the canvas).
 * Strip `execution` with `toFunctionToolDefinition()` before sending to a provider.
 */
export const mermaidTool: DrawingTool = {
  name: 'render_mermaid',
  description: 'Write Mermaid source into the editor/canvas and render it. Provide the COMPLETE diagram source.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Complete Mermaid diagram source.' },
    },
    required: ['source'],
  },
  execution: 'local',
};
