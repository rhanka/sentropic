import { describe, it, expect } from 'vitest';
import {
  type ChatToolScopeToggle,
  type WorkspaceType,
  getWorkspaceTypeToolIds,
  filterToolTogglesByWorkspaceType,
} from '../src/lib/utils/chat-tool-scope';

const TOGGLES: ChatToolScopeToggle[] = [
  { id: 'web', toolIds: ['web_search', 'web_extract'] },
  { id: 'initiative', toolIds: ['initiative_get', 'initiative_update'] },
  { id: 'solutions', toolIds: ['solutions_list', 'solution_get'] },
  { id: 'bids', toolIds: ['bids_list', 'bid_get'] },
  { id: 'products', toolIds: ['products_list', 'product_get'] },
  { id: 'gate', toolIds: ['gate_review'] },
  { id: 'workspace', toolIds: ['workspace_list'] },
  { id: 'cross_search', toolIds: ['initiative_search'] },
  { id: 'dispatch', toolIds: ['task_dispatch'] },
];

describe('getWorkspaceTypeToolIds', () => {
  it('returns empty set for ai-ideas', () => {
    expect(getWorkspaceTypeToolIds('ai-ideas').size).toBe(0);
  });

  it('returns extended object tools for opportunity', () => {
    const tools = getWorkspaceTypeToolIds('opportunity');
    expect(tools.has('solutions_list')).toBe(true);
    expect(tools.has('bids_list')).toBe(true);
    expect(tools.has('products_list')).toBe(true);
    expect(tools.has('gate_review')).toBe(true);
    expect(tools.has('workspace_list')).toBe(false);
  });

  it('returns cross-workspace tools for neutral', () => {
    const tools = getWorkspaceTypeToolIds('neutral');
    expect(tools.has('workspace_list')).toBe(true);
    expect(tools.has('initiative_search')).toBe(true);
    expect(tools.has('task_dispatch')).toBe(true);
    expect(tools.has('solutions_list')).toBe(false);
  });

  it('returns empty set for code', () => {
    expect(getWorkspaceTypeToolIds('code').size).toBe(0);
  });

  it('returns empty set for null', () => {
    expect(getWorkspaceTypeToolIds(null).size).toBe(0);
  });
});

describe('filterToolTogglesByWorkspaceType', () => {
  it('should keep only base tools for ai-ideas workspace', () => {
    const filtered = filterToolTogglesByWorkspaceType(TOGGLES, 'ai-ideas');
    const ids = filtered.map((t) => t.id);
    expect(ids).toContain('web');
    expect(ids).toContain('initiative');
    expect(ids).not.toContain('solutions');
    expect(ids).not.toContain('bids');
    expect(ids).not.toContain('workspace');
  });

  it('should include extended object tools for opportunity workspace', () => {
    const filtered = filterToolTogglesByWorkspaceType(TOGGLES, 'opportunity');
    const ids = filtered.map((t) => t.id);
    expect(ids).toContain('web');
    expect(ids).toContain('initiative');
    expect(ids).toContain('solutions');
    expect(ids).toContain('bids');
    expect(ids).toContain('products');
    expect(ids).toContain('gate');
    expect(ids).not.toContain('workspace');
    expect(ids).not.toContain('cross_search');
  });

  it('should include cross-workspace tools for neutral workspace', () => {
    const filtered = filterToolTogglesByWorkspaceType(TOGGLES, 'neutral');
    const ids = filtered.map((t) => t.id);
    expect(ids).toContain('web');
    expect(ids).toContain('initiative');
    expect(ids).toContain('workspace');
    expect(ids).toContain('cross_search');
    expect(ids).toContain('dispatch');
    expect(ids).not.toContain('solutions');
    expect(ids).not.toContain('bids');
  });

  it('should keep only base tools for code workspace', () => {
    const filtered = filterToolTogglesByWorkspaceType(TOGGLES, 'code');
    const ids = filtered.map((t) => t.id);
    expect(ids).toContain('web');
    expect(ids).toContain('initiative');
    expect(ids).not.toContain('solutions');
    expect(ids).not.toContain('workspace');
  });

  it('should keep all non-specific tools when workspace type is null', () => {
    const filtered = filterToolTogglesByWorkspaceType(TOGGLES, null);
    const ids = filtered.map((t) => t.id);
    expect(ids).toContain('web');
    expect(ids).toContain('initiative');
    expect(ids).not.toContain('solutions');
    expect(ids).not.toContain('workspace');
  });
});
