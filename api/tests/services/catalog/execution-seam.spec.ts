/**
 * CatalogExecutionSeam — unit tests (BR-42b Lot 2)
 *
 * Covers:
 *   - A non-hardcoded tool name registered as a `tool` entry dispatches
 *     through the seam and invokes its handler.
 *   - An unknown name (not in the catalog) returns `{ handled: false }`.
 *   - A hardcoded foundation name is NOT intercepted by the seam — it is
 *     handled by foundation-executor first and never reaches the seam.
 *   - A `skill`-kind entry does NOT dispatch through the seam
 *     (D-TOOL-RECONCILE: skill execution stays in foundation-executor).
 *   - Async handlers are awaited correctly.
 *   - The seam returns `handled: false` when a `tool` entry exists in the
 *     catalog but no source has a handler for it (no handler source wired).
 */

import { describe, expect, it, vi } from 'vitest';

import { CompositeCatalogRegistry } from '../../../src/services/catalog/composite-registry';
import { CatalogExecutionSeam } from '../../../src/services/catalog/execution-seam';
import { StandaloneToolSource } from '../../../src/services/catalog/sources/standalone-tool-source';
import { StaticCatalogSource } from '../../../src/services/catalog/sources/static-source';

// ---------------------------------------------------------------------------
// Helpers — build isolated seam + registry instances for each test group
// ---------------------------------------------------------------------------

function makeSampleTool(name: string) {
  return {
    name,
    description: `${name} tool for seam tests.`,
    inputSchema: {
      type: 'object' as const,
      properties: { value: { type: 'string' } },
    },
  };
}

function makeSeamFixture() {
  const standaloneSource = new StandaloneToolSource('seam-test');
  const registry = new CompositeCatalogRegistry();
  registry.addSource(standaloneSource);
  const seam = new CatalogExecutionSeam(registry, [standaloneSource]);
  return { seam, registry, standaloneSource };
}

// ---------------------------------------------------------------------------
// § 1  Non-hardcoded standalone tool dispatches correctly
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — standalone tool dispatch', () => {
  it('invokes the handler for a registered standalone tool and returns handled:true', async () => {
    const { seam, standaloneSource } = makeSeamFixture();
    const handler = vi.fn(async (args: Record<string, unknown>) => ({
      echoed: args.value,
    }));

    standaloneSource.register({
      tool: makeSampleTool('echo_tool'),
      handler,
    });

    const result = await seam.execute('echo_tool', { value: 'hello' });

    expect(result.handled).toBe(true);
    expect(result.result).toEqual({ echoed: 'hello' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 'hello' });
  });

  it('passes args correctly to sync handlers (non-async)', async () => {
    const { seam, standaloneSource } = makeSeamFixture();
    standaloneSource.register({
      tool: makeSampleTool('sync_tool'),
      // sync handler (returns a plain value, not a Promise)
      handler: (args: Record<string, unknown>) => ({ doubled: String(args.value) + String(args.value) }),
    });

    const result = await seam.execute('sync_tool', { value: 'x' });
    expect(result.handled).toBe(true);
    expect(result.result).toEqual({ doubled: 'xx' });
  });

  it('returns handled:true with undefined result when handler returns undefined', async () => {
    const { seam, standaloneSource } = makeSeamFixture();
    standaloneSource.register({
      tool: makeSampleTool('void_tool'),
      handler: async () => undefined,
    });

    const result = await seam.execute('void_tool', {});
    expect(result.handled).toBe(true);
    expect(result.result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 2  Unknown name → handled:false
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — unknown names return handled:false', () => {
  it('returns handled:false for a name absent from the catalog', async () => {
    const { seam } = makeSeamFixture();
    const result = await seam.execute('__completely_unknown__', {});
    expect(result.handled).toBe(false);
    expect(result.result).toBeUndefined();
  });

  it('returns handled:false for an empty string tool name', async () => {
    const { seam } = makeSeamFixture();
    const result = await seam.execute('', {});
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 3  Hardcoded foundation names are NOT intercepted by the seam
//
// This test validates the dispatch ordering invariant:
//   foundation-executor's hardcoded branches fire FIRST;
//   the seam is ONLY consulted for names that fall through all hardcoded checks.
//
// We simulate this by verifying that even if a hardcoded name were somehow
// registered as a standalone tool, the seam would find it — but the seam
// is never reached for hardcoded names because foundation-executor short-circuits.
//
// The live proof is in catalog-characterization.spec.ts §6 which shows
// foundation-executor returns handled:true for search_skills and dispatches
// all hardcoded tools before reaching the seam fall-through point.
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — hardcoded foundation names are not its concern', () => {
  it('hardcoded foundation tool names do not appear in the standalone source (D-TOOL-RECONCILE)', () => {
    // These are the hardcoded tool names in foundation-executor.ts.
    const HARDCODED_NAMES = [
      'search_skills',
      'workspace_list',
      'initiative_search',
      'matrix_get',
      'matrix_update',
      'read_initiative',
      'update_initiative',
      'organizations_list',
      'organization_get',
      'organization_update',
      'folders_list',
      'folder_get',
      'folder_update',
      'initiatives_list',
      'executive_summary_get',
      'executive_summary_update',
      'solutions_list',
      'solution_get',
      'proposals_list',
      'proposal_get',
      'products_list',
      'product_get',
      'gate_review',
      'history_analyze',
      'documents',
      'comment_assistant',
      'plan',
      'document_generate',
    ] as const;

    const { standaloneSource } = makeSeamFixture();
    // None of the hardcoded names should be in the standalone source.
    for (const name of HARDCODED_NAMES) {
      expect(standaloneSource.getHandler(name)).toBeUndefined();
    }
  });

  it('seam returns handled:false for a hardcoded foundation name NOT registered as standalone', async () => {
    // The seam only knows about entries in the composite registry.
    // If 'workspace_list' is not registered as a standalone tool, the seam
    // returns handled:false — foundation-executor handles it first anyway.
    const { seam } = makeSeamFixture();
    const result = await seam.execute('workspace_list', {});
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 4  D-TOOL-RECONCILE — skill-kind entries are NOT dispatched by the seam
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — skill-kind entries are NOT dispatched (D-TOOL-RECONCILE)', () => {
  it('returns handled:false for a name that matches a skill-kind entry (not a tool-kind entry)', async () => {
    // Wire the foundation static source — it emits skill-kind entries.
    const skillSource = new StaticCatalogSource('foundation');
    const registry = new CompositeCatalogRegistry();
    registry.addSource(skillSource);
    const standaloneSource = new StandaloneToolSource('seam-skill-test');
    registry.addSource(standaloneSource);
    const seam = new CatalogExecutionSeam(registry, [standaloneSource]);

    // 'workspace' is a skill name (kind: 'skill'), not a standalone tool (kind: 'tool').
    // The seam must NOT dispatch it.
    const entry = registry.get('workspace');
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('skill'); // confirm it's skill-kind

    // The seam must return handled:false for skill-kind entries.
    const result = await seam.execute('workspace', {});
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 5  No handler source wired → handled:false even when entry exists
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — no handler source wired', () => {
  it('returns handled:false when tool entry exists in registry but no handler source is provided', async () => {
    const standaloneSource = new StandaloneToolSource('seam-no-handler');
    standaloneSource.register({
      tool: makeSampleTool('orphan_tool'),
      handler: async () => 'should not be reached',
    });

    const registry = new CompositeCatalogRegistry();
    registry.addSource(standaloneSource);

    // Pass NO handler sources to the seam.
    const seam = new CatalogExecutionSeam(registry, []);

    // The entry IS in the registry, but the seam has no handler source.
    const result = await seam.execute('orphan_tool', {});
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 6  Multiple handler sources — first match wins
// ---------------------------------------------------------------------------

describe('CatalogExecutionSeam — multiple sources, first match wins', () => {
  it('dispatches through the first source that has a handler for the name', async () => {
    const source1 = new StandaloneToolSource('source-1');
    const source2 = new StandaloneToolSource('source-2');

    const handler1 = vi.fn(async () => ({ from: 'source-1' }));
    const handler2 = vi.fn(async () => ({ from: 'source-2' }));

    source1.register({ tool: makeSampleTool('shared_tool'), handler: handler1 });
    source2.register({ tool: makeSampleTool('only_in_2'), handler: handler2 });

    const registry = new CompositeCatalogRegistry();
    registry.addSource(source1);
    registry.addSource(source2);

    const seam = new CatalogExecutionSeam(registry, [source1, source2]);

    // 'shared_tool' is in source1 — source1's handler fires.
    const result1 = await seam.execute('shared_tool', {});
    expect(result1.handled).toBe(true);
    expect(result1.result).toEqual({ from: 'source-1' });
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();

    // 'only_in_2' is only in source2.
    // Note: registry will find the entry from source2's snapshot.
    const result2 = await seam.execute('only_in_2', {});
    expect(result2.handled).toBe(true);
    expect(result2.result).toEqual({ from: 'source-2' });
    expect(handler2).toHaveBeenCalledOnce();
  });
});
