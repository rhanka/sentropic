import type { ValidationResult } from '../types';

/**
 * Real mermaid validation via `mermaid.parse` (no DOM rendering). Async.
 * Returns errors instead of throwing. Used as the canonical `DrawingSkill.validate`.
 */
export async function mermaidParse(source: string): Promise<ValidationResult> {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, errors: ['empty source'] };
  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    await mermaid.parse(trimmed);
    return { ok: true };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}
