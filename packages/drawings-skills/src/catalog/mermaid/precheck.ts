import type { ValidationResult } from '../types';

/** Diagram keywords mermaid v11 source can start with. */
export const MERMAID_KEYWORDS = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph',
  'mindmap', 'timeline', 'quadrantChart', 'requirementDiagram', 'C4Context',
  'sankey-beta', 'xychart-beta', 'block-beta',
] as const;

/**
 * Cheap, synchronous heuristic — NOT a real parse. Use `mermaidParse` for correctness.
 * Good enough to gate obviously-wrong input (empty / no diagram keyword) without loading mermaid.
 */
export function mermaidPrecheck(source: string): ValidationResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, errors: ['empty source'] };
  if (!MERMAID_KEYWORDS.some((k) => trimmed.startsWith(k))) {
    const firstWord = trimmed.split(/\s|\n/, 1)[0] ?? '';
    return { ok: false, errors: [`source does not start with a known mermaid keyword: "${firstWord}"`] };
  }
  return { ok: true };
}
