import type { DrawingAgent } from '../types';
import { mermaidSkill } from './skill';

/** The live LLM call is injected by the API (llm-mesh + provider SDK); the lib stays pure/testable. */
export interface MermaidGenerate {
  (input: { prompt: string; currentSource?: string; systemPrompt: string }): Promise<string>;
}

/** generate -> validate -> (retry once on invalid). */
export function createMermaidAgent(deps: { generate: MermaidGenerate }): DrawingAgent {
  return {
    formatId: 'mermaid',
    async run({ prompt, currentSource }) {
      const systemPrompt = mermaidSkill.systemPrompt;
      let source = await deps.generate({ prompt, currentSource, systemPrompt });
      const verdict = await mermaidSkill.validate(source);
      if (!verdict.ok) {
        source = await deps.generate({
          prompt: `${prompt}\n\n(The previous output was invalid Mermaid: ${verdict.errors.join('; ')}. Return corrected, valid Mermaid only — no prose, no code fences.)`,
          currentSource,
          systemPrompt,
        });
      }
      return { source };
    },
  };
}
