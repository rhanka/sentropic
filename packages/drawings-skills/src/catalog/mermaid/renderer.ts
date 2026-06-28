import type { RendererPort, RenderResult } from '../../canvas/types';

/** Mermaid renderer. Real SVG rendering needs a DOM — asserted in Playwright (Lot 6), not jsdom. */
export function createMermaidRenderer(): RendererPort {
  let seq = 0;
  return {
    async render(source, target): Promise<RenderResult> {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        const { svg } = await mermaid.render(`dsk-mmd-${seq++}`, source);
        target.innerHTML = svg;
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async exportSvg(source): Promise<string> {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const { svg } = await mermaid.render(`dsk-export-${seq++}`, source);
      return svg;
    },
  };
}
