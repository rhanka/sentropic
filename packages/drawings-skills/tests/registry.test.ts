import { describe, it, expect } from 'vitest';
import { createDrawingRegistry } from '../src/catalog/registry';
import type { DrawingFormat } from '../src/catalog/types';

const fakeFormat = (id: string): DrawingFormat => ({
  id,
  label: id,
  fileExtension: `.${id}`,
  capabilities: { render: true },
  skill: { formatId: id, name: `${id}-gen`, description: '', systemPrompt: '', validate: async () => ({ ok: true }) },
  tool: {
    name: `render_${id}`,
    description: '',
    parameters: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] },
    execution: 'local',
  },
  agent: { formatId: id, run: async () => ({ source: '' }) },
  createRenderer: () => ({ render: async () => ({ ok: true }) }),
});

describe('createDrawingRegistry', () => {
  it('registers and retrieves a format by id', () => {
    const r = createDrawingRegistry();
    r.register(fakeFormat('mermaid'));
    expect(r.get('mermaid')?.id).toBe('mermaid');
    expect(r.list().map((f) => f.id)).toEqual(['mermaid']);
    expect(r.getTool('mermaid')?.name).toBe('render_mermaid');
    expect(r.getSkill('mermaid')?.name).toBe('mermaid-gen');
  });

  it('returns undefined for an unknown id (incl. getTool/getSkill)', () => {
    const r = createDrawingRegistry();
    expect(r.get('nope')).toBeUndefined();
    expect(r.getTool('nope')).toBeUndefined();
    expect(r.getSkill('nope')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    const r = createDrawingRegistry();
    r.register(fakeFormat('mermaid'));
    expect(() => r.register(fakeFormat('mermaid'))).toThrow(/already registered/i);
  });
});
