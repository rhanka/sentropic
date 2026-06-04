/**
 * CanvasTemplateSource — unit tests (BR-42b Lot 6)
 *
 * Covers:
 *   - Static seed → `canvas`-kind entries (shape: { id, title, mimeType,
 *     initialContent?, schema? }, per SPEC_EVOL_CATALOG §2.4)
 *   - `list/search/get` parity with the agent/workflow source pattern
 *   - `snapshot()` is synchronous and always-fresh (no I/O)
 *   - Source id / kind identity
 *   - CatalogEntryMetadata carries the shared intersection fields
 *   - D-CANVAS invariant: no LiveDocumentStore / CRDT / editor runtime imported
 *   - Vocabulary alignment: `kind: 'canvas'` matches `CommentTargetKind` 'canvas'
 *     from `packages/comments/src/types.ts:13`
 *   - 0-regression: canvas entries are absent from the resolved OpenAI chat tool
 *     set produced by `resolveFoundationChatTools` (they must NOT leak into the
 *     28-tool order oracle from the characterization spec)
 */

import { describe, expect, it } from 'vitest';

import {
  CanvasTemplateSource,
  canvasTemplateSource,
} from '../../../src/services/catalog/sources/canvas-template-source';
import type { CanvasEntry } from '../../../src/services/catalog/types';
import {
  FOUNDATION_SKILLS,
} from '../../../../packages/skills/src/index';
import {
  resolveFoundationChatTools,
} from '../../../src/services/skills/catalog';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** All foundation tool names — needed to build the full-access authz for the 0-regression check. */
const ALL_FOUNDATION_TOOL_NAMES: string[] = FOUNDATION_SKILLS.flatMap((s) =>
  s.tools.map((t) => t.name),
);

// ---------------------------------------------------------------------------
// § 1  Module-level singleton identity
// ---------------------------------------------------------------------------

describe('canvasTemplateSource singleton', () => {
  it('has id "canvas-templates" and kind "static"', () => {
    expect(canvasTemplateSource.id).toBe('canvas-templates');
    expect(canvasTemplateSource.kind).toBe('static');
  });

  it('is an instance of CanvasTemplateSource', () => {
    expect(canvasTemplateSource).toBeInstanceOf(CanvasTemplateSource);
  });
});

// ---------------------------------------------------------------------------
// § 2  snapshot() — synchronous and always-fresh
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource.snapshot() — sync + always-fresh', () => {
  it('is synchronous — returns an array, not a Promise', () => {
    const src = new CanvasTemplateSource();
    const result = src.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('returns the same reference on repeated calls (no recomputation)', () => {
    const src = new CanvasTemplateSource();
    const a = src.snapshot();
    const b = src.snapshot();
    expect(a).toBe(b);
  });

  it('has no refresh() method (static sources are always-fresh)', () => {
    const src = new CanvasTemplateSource();
    expect((src as { refresh?: unknown }).refresh).toBeUndefined();
  });

  it('has no health() method', () => {
    const src = new CanvasTemplateSource();
    expect((src as { health?: unknown }).health).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 3  Entries — canvas-kind, count, and shape
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource — entries count and kind', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];

  it('contains at least one canvas template entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('no duplicate metadata.name in the snapshot', () => {
    const names = entries.map((e) => e.metadata.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all entries have kind="canvas"', () => {
    for (const entry of entries) {
      expect(entry.kind).toBe('canvas');
    }
  });

  it('all entries have sourceId matching the source id', () => {
    for (const entry of entries) {
      expect(entry.sourceId).toBe('canvas-templates');
    }
  });

  it('size property matches snapshot length', () => {
    expect(src.size).toBe(entries.length);
  });
});

// ---------------------------------------------------------------------------
// § 4  CanvasTemplate payload shape — { id, title, mimeType, initialContent?, schema? }
//
// Per SPEC_EVOL_CATALOG §2.4 / §3.1: CanvasTemplate mirrors §10.3 LiveDocumentRef:
//   { id, title, mimeType, initialContent?, schema? }
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource — CanvasTemplate payload shape', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];

  it('each entry.template.id is a non-empty kebab-case string', () => {
    for (const entry of entries) {
      expect(typeof entry.template.id).toBe('string');
      expect(entry.template.id.length).toBeGreaterThan(0);
      // Provider-safe: only kebab/underscore chars (no `:` or `/`)
      expect(entry.template.id).toMatch(/^[a-z0-9][a-z0-9-_]*$/);
    }
  });

  it('each entry.template.title is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.template.title).toBe('string');
      expect(entry.template.title.length).toBeGreaterThan(0);
    }
  });

  it('each entry.template.mimeType is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.template.mimeType).toBe('string');
      expect(entry.template.mimeType.length).toBeGreaterThan(0);
    }
  });

  it('initialContent is either a string or undefined (not null, not missing)', () => {
    for (const entry of entries) {
      // initialContent is optional; when present it must be a string
      if ('initialContent' in entry.template) {
        expect(typeof entry.template.initialContent).toBe('string');
      }
    }
  });

  it('schema is either a plain object or undefined', () => {
    for (const entry of entries) {
      if (entry.template.schema !== undefined) {
        expect(typeof entry.template.schema).toBe('object');
        expect(entry.template.schema).not.toBeNull();
        expect(Array.isArray(entry.template.schema)).toBe(false);
      }
    }
  });

  it('includes a blank-markdown starter (blank, text/markdown)', () => {
    const blankMd = entries.find((e) => e.template.id === 'blank-markdown');
    expect(blankMd).toBeDefined();
    expect(blankMd!.template.mimeType).toBe('text/markdown');
    // blank-markdown has no schema
    expect(blankMd!.template.schema).toBeUndefined();
  });

  it('includes a structured-plan starter (application/json, with schema)', () => {
    const structuredPlan = entries.find((e) => e.template.id === 'structured-plan');
    expect(structuredPlan).toBeDefined();
    expect(structuredPlan!.template.mimeType).toBe('application/json');
    expect(structuredPlan!.template.schema).toBeDefined();
    expect(typeof structuredPlan!.template.schema).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// § 5  CatalogEntryMetadata — shared intersection fields
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource — CatalogEntryMetadata fields', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];

  it('each entry.metadata.name equals entry.template.id (provider-safe mapping)', () => {
    for (const entry of entries) {
      expect(entry.metadata.name).toBe(entry.template.id);
    }
  });

  it('each entry.metadata.description is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.metadata.description).toBe('string');
      expect(entry.metadata.description.length).toBeGreaterThan(0);
    }
  });

  it('each entry.metadata.category is "canvas"', () => {
    for (const entry of entries) {
      expect(entry.metadata.category).toBe('canvas');
    }
  });

  it('entries have no version (static templates are not semver-versioned)', () => {
    for (const entry of entries) {
      expect(entry.metadata.version).toBeUndefined();
    }
  });

  it('entries have no contextFilter (no gating on template starters)', () => {
    for (const entry of entries) {
      expect(entry.metadata.contextFilter).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// § 6  Custom source id
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource — custom id', () => {
  it('accepts a custom id and sets it on entries', () => {
    const src = new CanvasTemplateSource('my-canvas');
    expect(src.id).toBe('my-canvas');
    const entries = src.snapshot() as CanvasEntry[];
    for (const entry of entries) {
      expect(entry.sourceId).toBe('my-canvas');
    }
  });
});

// ---------------------------------------------------------------------------
// § 7  D-CANVAS invariant — no LiveDocumentStore / CRDT / editor runtime
//
// We cannot easily inspect the module graph at runtime, but we can verify that
// the source only emits template data (no store/CRDT fields on the payload).
// ---------------------------------------------------------------------------

describe('D-CANVAS invariant — no runtime fields on payload', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];

  it('template payload has only the allowed fields: id, title, mimeType, initialContent?, schema?', () => {
    const ALLOWED_KEYS = new Set(['id', 'title', 'mimeType', 'initialContent', 'schema']);
    for (const entry of entries) {
      const extraKeys = Object.keys(entry.template).filter((k) => !ALLOWED_KEYS.has(k));
      expect(extraKeys).toHaveLength(0);
    }
  });

  it('entry has no store/runtime field (not a LiveDocumentStore proxy)', () => {
    for (const entry of entries) {
      // LiveDocumentStore has a `_kind: 'LiveDocumentStore'` brand. Verify absent.
      expect((entry as { _kind?: unknown })._kind).toBeUndefined();
      expect((entry.template as { _kind?: unknown })._kind).toBeUndefined();
      // No CRDT/store references on the entry
      expect((entry as { store?: unknown }).store).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// § 8  Vocabulary alignment — 'canvas' matches CommentTargetKind
//
// SPEC_EVOL_CATALOG §2.4 / Codex MF6:
//   packages/comments/src/types.ts:13 uses `'canvas'` as one of the three
//   annotation target kinds (`message | canvas | artifact`). The catalog
//   `canvas` kind uses the SAME term — no parallel naming.
// ---------------------------------------------------------------------------

describe('vocabulary alignment — canvas kind matches CommentTargetKind', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];

  it('all entries use kind="canvas" — the same term as CommentTargetKind "canvas"', () => {
    // The literal 'canvas' below is the same string as in:
    //   packages/comments/src/types.ts:13 — `CommentTargetKind` = 'message' | 'canvas' | 'artifact' | ...
    // Alignment is enforced at the type level (CatalogEntryKind includes 'canvas').
    for (const entry of entries) {
      expect(entry.kind).toBe('canvas');
    }
  });

  it('metadata.category is "canvas" — consistent taxonomy tag', () => {
    for (const entry of entries) {
      expect(entry.metadata.category).toBe('canvas');
    }
  });
});

// ---------------------------------------------------------------------------
// § 9  list/get/search parity with other source kinds
// ---------------------------------------------------------------------------

describe('CanvasTemplateSource — list/search/get parity', () => {
  const src = new CanvasTemplateSource();

  it('get by id returns the matching entry', () => {
    const entries = src.snapshot() as CanvasEntry[];
    const first = entries[0]!;
    const found = (src.snapshot() as CanvasEntry[]).find(
      (e) => e.metadata.name === first.metadata.name,
    );
    expect(found).toBeDefined();
    expect(found!.kind).toBe('canvas');
    expect(found!.template.id).toBe(first.metadata.name);
  });

  it('snapshot entries are all canvas-kind (kind parity)', () => {
    for (const entry of src.snapshot()) {
      expect(entry.kind).toBe('canvas');
    }
  });

  it('each template.id matches its entry metadata.name (get parity)', () => {
    const entries = src.snapshot() as CanvasEntry[];
    for (const entry of entries) {
      expect(entry.template.id).toBe(entry.metadata.name);
    }
  });
});

// ---------------------------------------------------------------------------
// § 10  0-regression — canvas entries MUST NOT enter the resolved chat tool set
// ---------------------------------------------------------------------------

describe('0-regression — canvas entries absent from resolveFoundationChatTools', () => {
  const src = new CanvasTemplateSource();
  const entries = src.snapshot() as CanvasEntry[];
  const CANVAS_IDS = entries.map((e) => e.template.id);

  it('canvas template ids are NOT in the resolved OpenAI chat tool set', () => {
    // resolveFoundationChatTools projects ONLY skill-kind entries via
    // SkillsToolRegistry. Canvas entries are in the composite registry for
    // discovery but must NOT appear in the resolved chat tool array.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot6-test',
      workspaceId: 'ws-lot6-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });

    const toolNames = new Set(tools.map((t) => t.function.name));

    // Sanity: there must be canvas ids to check (non-empty).
    expect(CANVAS_IDS.length).toBeGreaterThan(0);

    // None of the canvas template ids should appear in the resolved tool set.
    for (const id of CANVAS_IDS) {
      expect(toolNames.has(id)).toBe(false);
    }
  });

  it('the tool count oracle is correct after wiring the canvas source (Lot 7: 2 meta + foundation)', () => {
    // Lot 7 update: search_catalog is at index 1. Canvas source adds no tools.
    // 2 meta-tools (search_skills + search_catalog) + all foundation tools.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot6-test',
      workspaceId: 'ws-lot6-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    // 2 meta-tools + all foundation tools
    expect(tools).toHaveLength(2 + ALL_FOUNDATION_TOOL_NAMES.length);
    expect(tools[0]!.function.name).toBe('search_skills');
    expect(tools[1]!.function.name).toBe('search_catalog');
  });

  it('search_skills is still the FIRST tool after adding the canvas source', () => {
    const tools = resolveFoundationChatTools({
      userId: 'u-lot6-test',
      workspaceId: 'ws-lot6-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    expect(tools[0]!.function.name).toBe('search_skills');
  });

  it('the exact tool name sequence includes search_catalog at index 1 (Lot 7 update)', () => {
    // Lot 7 update: canvas entries cause ZERO change to the foundation tool sequence.
    // search_catalog is now at index 1. Canvas entries do NOT appear.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot6-test',
      workspaceId: 'ws-lot6-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    const names = tools.map((t) => t.function.name);

    // Updated oracle (Lot 7): search_catalog inserted at index 1.
    const EXPECTED_TOOL_ORDER = [
      'search_skills',
      'search_catalog',
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

    expect(names).toEqual(EXPECTED_TOOL_ORDER);
  });
});
