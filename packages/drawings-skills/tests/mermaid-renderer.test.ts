import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock mermaid so the renderer contract is tested deterministically without real DOM layout.
// Real SVG output is asserted in Playwright (Lot 6).
const mermaidMock = vi.hoisted(() => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));
vi.mock('mermaid', () => mermaidMock);

import { createMermaidRenderer } from '../src/catalog/mermaid/renderer';

describe('mermaid renderer', () => {
  beforeEach(() => {
    mermaidMock.default.initialize.mockClear();
    mermaidMock.default.render.mockReset();
  });

  it('returns ok:false with the error when mermaid.render throws', async () => {
    mermaidMock.default.render.mockRejectedValue(new Error('Parse error on line 1'));
    const target = document.createElement('div');
    const res = await createMermaidRenderer().render('not a diagram', target);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Parse error');
  });

  it('initializes mermaid and writes the svg into the target on success', async () => {
    mermaidMock.default.render.mockResolvedValue({ svg: '<svg id="ok"></svg>' });
    const target = document.createElement('div');
    const res = await createMermaidRenderer().render('flowchart TD\n A-->B', target);
    expect(res.ok).toBe(true);
    expect(target.innerHTML).toContain('<svg');
    expect(mermaidMock.default.initialize).toHaveBeenCalled();
  });

  it('exportSvg initializes mermaid then returns the svg string', async () => {
    mermaidMock.default.render.mockResolvedValue({ svg: '<svg id="exp"></svg>' });
    const svg = await createMermaidRenderer().exportSvg!('flowchart TD\n A-->B');
    expect(svg).toContain('<svg');
    expect(mermaidMock.default.initialize).toHaveBeenCalled();
  });
});
