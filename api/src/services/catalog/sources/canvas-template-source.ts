/**
 * CanvasTemplateSource — `CatalogSource` for `canvas`-kind catalog entries
 * (BR-42b Lot 6)
 *
 * Exposes a small app-local static seed array of `canvas`-kind `CatalogEntry`
 * objects, giving `list/search/get` parity with the other catalog source kinds.
 *
 * Canvas source (D-CANVAS RESOLVED — SPEC_EVOL_CATALOG §2.4):
 *   No existing canvas/LiveDocument template seeds were found in the codebase
 *   (canvas runtime is carved out to `SPEC_EVOL_CHAT_CANVAS`; it is a named
 *   carve-out only, not yet a present file). Therefore this source defines a
 *   MINIMAL static seed array of representative starter templates inline:
 *     1. blank-markdown  — blank Markdown document (text/markdown)
 *     2. structured-plan — structured JSON planning document (application/json)
 *   These are KIND/TEMPLATE-ONLY starters. No `LiveDocumentStore`/CRDT/editor
 *   runtime is included or imported (forbidden path: `SPEC_EVOL_CHAT_CANVAS`).
 *
 * Vocabulary alignment (SPEC_EVOL_CATALOG §2.4 / Codex MF6):
 *   The entry `kind: 'canvas'` matches `CommentTargetKind` `'canvas'` from
 *   `packages/comments/src/types.ts:13`. The `comments` package uses
 *   `message | canvas | artifact` as annotation target kinds; we use the same
 *   `'canvas'` term here — no parallel naming invented.
 *
 * 0-regression invariant:
 *   `canvas`-kind entries are for discovery (list/search/get) ONLY. They are
 *   NOT wired into the `SkillsToolRegistry` or `resolveFoundationChatTools` path,
 *   so the resolved OpenAI chat tool set stays byte-identical to the pre-Lot-6
 *   baseline. `resolveFoundationChatTools` projects ONLY `skill`-kind entries.
 *
 * `metadata.name` mapping:
 *   Each template's `id` is already kebab-case (e.g. `blank-markdown`),
 *   which is provider-safe. We use `id` directly as `metadata.name` so that
 *   `get(id)` works without any transformation.
 *
 * Source id:  `'canvas-templates'`
 * Source kind: `'static'` (in-process constant; no async refresh needed)
 */

import type { CatalogSource } from '../source.js';
import type { CanvasEntry, CanvasTemplate, CatalogEntry } from '../types.js';

// ---------------------------------------------------------------------------
// App-local static canvas template seed array
//
// No existing canvas seeds found in the repo (canvas runtime carved out).
// This is a MINIMAL representative set — kind/template ONLY, no runtime.
//
// Vocabulary note: the `canvas` kind aligns with CommentTargetKind `'canvas'`
// from packages/comments/src/types.ts:13. See module-level doc above.
// ---------------------------------------------------------------------------

const CANVAS_TEMPLATES: ReadonlyArray<CanvasTemplate> = [
  {
    id: 'blank-markdown',
    title: 'Blank Markdown Document',
    mimeType: 'text/markdown',
    initialContent: '',
    // No schema: free-form text content.
  },
  {
    id: 'structured-plan',
    title: 'Structured Planning Document',
    mimeType: 'application/json',
    initialContent: JSON.stringify(
      {
        title: '',
        sections: [],
      },
      null,
      2,
    ),
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// CanvasTemplateSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` backed by the app-local static canvas template seed array.
 *
 * Emits one `CanvasEntry` per static canvas template. The snapshot is
 * always-fresh (in-process constant, no I/O, no cache).
 *
 * D-CANVAS invariant: NO `LiveDocumentStore`/CRDT/editor runtime is imported
 * or referenced here. Canvas is kind/template ONLY in BR-42b.
 *
 * Vocabulary alignment: `kind: 'canvas'` matches `CommentTargetKind` `'canvas'`
 * from `packages/comments/src/types.ts:13`.
 */
export class CanvasTemplateSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'static' as const;

  private readonly entries: ReadonlyArray<CanvasEntry>;

  /**
   * @param id  Source identifier. Defaults to `'canvas-templates'`.
   */
  constructor(id = 'canvas-templates') {
    this.id = id;
    this.entries = buildCanvasEntries(id);
  }

  /**
   * SYNC — returns the pre-built canvas template entries array.
   * Always-fresh: backed by compile-time constants; no I/O.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this.entries;
  }

  // No `refresh()` — static sources are always-fresh by definition.
  // No `health()` — in-process constant; never unhealthy.

  /**
   * Return the number of distinct canvas template entries in the snapshot.
   */
  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Build helper
// ---------------------------------------------------------------------------

/**
 * Map the static `CANVAS_TEMPLATES` seed array to `CanvasEntry` objects.
 *
 * D-CANVAS invariant: only template metadata + `CanvasTemplate` payload.
 * No DB queries, no runtime store, no CRDT references.
 */
function buildCanvasEntries(sourceId: string): ReadonlyArray<CanvasEntry> {
  return CANVAS_TEMPLATES.map((template) => canvasToEntry(template, sourceId));
}

/**
 * Map a `CanvasTemplate` to a `CanvasEntry`.
 *
 * `metadata.name` = `template.id` (already provider-safe kebab-case).
 * `metadata.description` = descriptive label combining title + mimeType.
 * `metadata.category` = `'canvas'` (taxonomy tag for canvas-kind discovery).
 *
 * Vocabulary: `kind: 'canvas'` matches `CommentTargetKind` `'canvas'`
 * from `packages/comments/src/types.ts:13`.
 */
function canvasToEntry(template: CanvasTemplate, sourceId: string): CanvasEntry {
  return {
    kind: 'canvas',
    sourceId,
    metadata: {
      name: template.id,
      description: `${template.title} (${template.mimeType})`,
      category: 'canvas',
    },
    template,
  };
}

// ---------------------------------------------------------------------------
// Module-level singleton (consumed by the wired catalog.ts)
// ---------------------------------------------------------------------------

/**
 * Singleton `CanvasTemplateSource` for all app-local canvas template starters.
 * Import this to wire canvas templates into `CompositeCatalogRegistry`.
 *
 * The singleton emits only kind/template entries; no `LiveDocumentStore`,
 * CRDT, or editor runtime is included (D-CANVAS invariant).
 */
export const canvasTemplateSource = new CanvasTemplateSource('canvas-templates');
