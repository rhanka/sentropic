/**
 * StandaloneToolSource — unit tests (BR-42b Lot 2)
 *
 * Covers:
 *   - Standalone `tool` entry shape (public name / rawName / handler in side-table)
 *   - `snapshot()` is synchronous and always-fresh
 *   - D-TOOL-RECONCILE: skill-owned tools must NOT be registered here
 *     (documented invariant; enforced by convention + this test as the live spec)
 *   - `register()` / `unregister()` lifecycle
 *   - Duplicate-name guard
 *   - `getHandler()` lookup
 *   - Module-level singleton `standaloneToolSource` starts empty
 */

import { describe, expect, it } from 'vitest';
import {
  StandaloneToolSource,
  standaloneToolSource,
} from '../../../src/services/catalog/sources/standalone-tool-source';
import type { ToolEntry } from '../../../src/services/catalog/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_TOOL = {
  name: 'standalone_greet',
  description: 'Greet a user by name.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'The name to greet.' },
    },
    required: ['name'],
  },
};

const SAMPLE_HANDLER = async (args: Record<string, unknown>) => ({
  greeting: `Hello, ${args.name as string}!`,
});

// ---------------------------------------------------------------------------
// § 1  Module-level singleton starts empty
// ---------------------------------------------------------------------------

describe('standaloneToolSource singleton', () => {
  it('starts with zero entries (empty by default in Lot 2)', () => {
    // The module-level singleton must be empty at start.
    // Lot 5 (MCP) will populate it when servers connect.
    expect(standaloneToolSource.size).toBe(0);
    expect(standaloneToolSource.snapshot()).toHaveLength(0);
  });

  it('has id "standalone" and kind "static"', () => {
    expect(standaloneToolSource.id).toBe('standalone');
    expect(standaloneToolSource.kind).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// § 2  ToolEntry shape after registration
// ---------------------------------------------------------------------------

describe('StandaloneToolSource — tool entry shape', () => {
  it('registers a tool and snapshot returns a well-formed ToolEntry', () => {
    const source = new StandaloneToolSource('test-shape');
    source.register({
      tool: SAMPLE_TOOL,
      handler: SAMPLE_HANDLER,
    });

    const entries = source.snapshot();
    expect(entries).toHaveLength(1);

    const entry = entries[0] as ToolEntry;
    expect(entry.kind).toBe('tool');
    expect(entry.sourceId).toBe('test-shape');
    expect(entry.metadata.name).toBe('standalone_greet');
    expect(entry.metadata.description).toBe('Greet a user by name.');
    expect(entry.tool).toBe(SAMPLE_TOOL);
    // rawName is absent when not provided
    expect(entry.rawName).toBeUndefined();
  });

  it('stores rawName when provided (for MCP-style name mapping)', () => {
    const source = new StandaloneToolSource('test-rawname');
    source.register({
      tool: { ...SAMPLE_TOOL, name: 'mcp_server_greet' },
      rawName: 'mcp:my-server/greet',
      handler: SAMPLE_HANDLER,
    });

    const entries = source.snapshot();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as ToolEntry;
    expect(entry.metadata.name).toBe('mcp_server_greet');
    expect(entry.rawName).toBe('mcp:my-server/greet');
  });

  it('stores optional version and category in metadata', () => {
    const source = new StandaloneToolSource('test-meta');
    source.register({
      tool: SAMPLE_TOOL,
      handler: SAMPLE_HANDLER,
      version: '1.2.3',
      category: 'utilities',
    });

    const entry = source.snapshot()[0] as ToolEntry;
    expect(entry.metadata.version).toBe('1.2.3');
    expect(entry.metadata.category).toBe('utilities');
  });
});

// ---------------------------------------------------------------------------
// § 3  snapshot() contract — sync and always-fresh
// ---------------------------------------------------------------------------

describe('StandaloneToolSource.snapshot — synchronous and always-fresh', () => {
  it('keeps discovery snapshots effect-free', () => {
    let calls = 0;
    const source = new StandaloneToolSource('discovery-only');
    source.register({
      tool: SAMPLE_TOOL,
      handler: async () => { calls += 1; return { effected: true }; },
    });
    source.snapshot();
    source.snapshot();
    expect(calls).toBe(0);
  });

  it('snapshot() returns a plain array (not a Promise)', () => {
    const source = new StandaloneToolSource('test-sync');
    const result = source.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('snapshot() reflects registrations immediately (no caching)', () => {
    const source = new StandaloneToolSource('test-fresh');
    expect(source.snapshot()).toHaveLength(0);

    source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });
    expect(source.snapshot()).toHaveLength(1);

    source.unregister('standalone_greet');
    expect(source.snapshot()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// § 4  register / unregister lifecycle
// ---------------------------------------------------------------------------

describe('StandaloneToolSource — register / unregister', () => {
  it('register() returns `this` for chaining', () => {
    const source = new StandaloneToolSource('test-chain');
    const returned = source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });
    expect(returned).toBe(source);
  });

  it('throws on duplicate registration of the same name', () => {
    const source = new StandaloneToolSource('test-dup');
    source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });
    expect(() =>
      source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER }),
    ).toThrow(/already registered/);
  });

  it('unregister() removes the entry and its handler', () => {
    const source = new StandaloneToolSource('test-unreg');
    source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });
    expect(source.size).toBe(1);

    source.unregister('standalone_greet');
    expect(source.size).toBe(0);
    expect(source.snapshot()).toHaveLength(0);
    expect(source.getHandler('standalone_greet')).toBeUndefined();
  });

  it('unregister() is a no-op for unknown names', () => {
    const source = new StandaloneToolSource('test-noop');
    expect(() => source.unregister('nonexistent')).not.toThrow();
  });

  it('multiple tools can be registered and preserve insertion order', () => {
    const source = new StandaloneToolSource('test-order');
    source.register({
      tool: { ...SAMPLE_TOOL, name: 'tool_a', description: 'Tool A.' },
      handler: async () => 'a',
    });
    source.register({
      tool: { ...SAMPLE_TOOL, name: 'tool_b', description: 'Tool B.' },
      handler: async () => 'b',
    });
    source.register({
      tool: { ...SAMPLE_TOOL, name: 'tool_c', description: 'Tool C.' },
      handler: async () => 'c',
    });

    const names = source.snapshot().map((e) => e.metadata.name);
    expect(names).toEqual(['tool_a', 'tool_b', 'tool_c']);
  });
});

// ---------------------------------------------------------------------------
// § 5  getHandler() — side-table lookup (handler is NOT in the CatalogEntry)
// ---------------------------------------------------------------------------

describe('StandaloneToolSource.getHandler', () => {
  it('returns the registered handler by public metadata.name', async () => {
    const source = new StandaloneToolSource('test-handler');
    source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });

    const handler = source.getHandler('standalone_greet');
    expect(handler).toBeDefined();

    const result = await handler!({ name: 'Alice' });
    expect(result).toEqual({ greeting: 'Hello, Alice!' });
  });

  it('returns undefined for an unregistered name', () => {
    const source = new StandaloneToolSource('test-handler-miss');
    expect(source.getHandler('nonexistent_tool')).toBeUndefined();
  });

  it('handler is NOT stored in the CatalogEntry itself (entries remain serialisable)', () => {
    const source = new StandaloneToolSource('test-no-handler-in-entry');
    source.register({ tool: SAMPLE_TOOL, handler: SAMPLE_HANDLER });

    const entry = source.snapshot()[0] as ToolEntry;
    // The CatalogEntry must NOT carry the handler — entries are plain data.
    expect((entry as Record<string, unknown>).handler).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 6  D-TOOL-RECONCILE — skill-owned tools must not be registered here
// ---------------------------------------------------------------------------

describe('D-TOOL-RECONCILE: skill-owned tools do NOT belong in StandaloneToolSource', () => {
  /**
   * This test documents the D-TOOL-RECONCILE invariant:
   *
   *   Skill-owned tools stay owned by their `skill`-kind catalog entry.
   *   They MUST NOT be duplicated as standalone `tool` entries in
   *   `StandaloneToolSource`.
   *
   * There is no runtime guard (the source cannot introspect the skills
   * registry to enforce this). The contract is enforced by convention.
   * This test acts as the live specification.
   *
   * A "skill-owned tool" is any tool whose name appears in a `Skill.tools`
   * array in the foundation bundle (or any other registered skill). These
   * tools are already surfaced through the `SkillsToolRegistry.resolveTools`
   * path and the `SkillEntry.skill.tools` array.
   *
   * Registering `workspace_list` (a skill-owned tool) here would create two
   * catalog entries with the same public name, breaking the collision policy
   * in `CompositeCatalogRegistry` and potentially routing the tool call
   * through the wrong handler.
   */
  it('documents the invariant: skill-owned tool names must not appear in the standalone source', () => {
    // The canonical list of skill-owned tool names from the characterization spec.
    const SKILL_OWNED_TOOL_NAMES = [
      'workspace_list',
      'initiative_search',
      'web_search',
      'web_extract',
      'organizations_list',
      'organization_get',
      'organization_update',
      'folders_list',
      'folder_get',
      'folder_update',
      'initiatives_list',
      'read_initiative',
      'update_initiative',
      'solutions_list',
      'solution_get',
      'proposals_list',
      'proposal_get',
      'products_list',
      'product_get',
      'executive_summary_get',
      'executive_summary_update',
      'matrix_get',
      'matrix_update',
      'history_analyze',
      'gate_review',
      'documents',
      'comment_assistant',
      'plan',
      'document_generate',
    ] as const;

    const source = new StandaloneToolSource('test-reconcile');
    // The standalone source starts empty — none of the skill-owned tool names
    // are present, which is the correct state.
    for (const name of SKILL_OWNED_TOOL_NAMES) {
      expect(source.getHandler(name)).toBeUndefined();
    }
    expect(source.size).toBe(0);

    // Verify the invariant spec: the snapshot has no entry with a skill-owned name.
    const snapshotNames = source.snapshot().map((e) => e.metadata.name);
    for (const name of SKILL_OWNED_TOOL_NAMES) {
      expect(snapshotNames).not.toContain(name);
    }
  });
});
