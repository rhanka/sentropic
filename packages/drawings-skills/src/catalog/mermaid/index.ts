import type { DrawingFormat } from '../types';
import { mermaidSkill } from './skill';
import { mermaidTool } from './tool';
import { createMermaidRenderer } from './renderer';
import { createMermaidAgent, type MermaidGenerate } from './agent';

/** Assemble the mermaid DrawingFormat. `deps.generate` is the injected LLM call (API-side). */
export function buildMermaidFormat(deps: { generate: MermaidGenerate }): DrawingFormat {
  return {
    id: 'mermaid',
    label: 'Mermaid',
    fileExtension: '.mmd',
    capabilities: { render: true, annotate: true },
    skill: mermaidSkill,
    tool: mermaidTool,
    agent: createMermaidAgent(deps),
    createRenderer: createMermaidRenderer,
  };
}

export { mermaidSkill } from './skill';
export { mermaidTool } from './tool';
export { createMermaidRenderer } from './renderer';
export { createMermaidAgent } from './agent';
export type { MermaidGenerate } from './agent';
export { mermaidPrecheck, MERMAID_KEYWORDS } from './precheck';
export { mermaidParse } from './parse';
