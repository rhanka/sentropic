# @sentropic/cited-source-viewer

Shared cited-source viewer — **one canonical UX, many modality bodies**.

This is Lot 2 of the cited-source-visualization WP (graphify #24), the shared
package the architect ratified under §S.5 (2026-07-04): package home
`packages/cited-source-viewer`, **ARCHITECT-owned public API**, DS-themed and
built on real `@sentropic/design-system-svelte` components. The frame UX is the
one the principal qualified on the graphify interim viewer (§S.6, immo/radar
`SignalPdfOverlay` parity): the SAME frame serves every modality; only the body
swaps.

```
header   kicker / title / active locator / ✕ close (DS IconButton)
toolbar  ‹ Citation x/y › · [Entité|Sélection] + ‹ Entité x/y › · ‹ Doc x/y ›
         · ‹ Page x/y › · − NN% + · Ouvrir ↗          (one compact DS bar)
quote    the active citation quote (blockquote strip)
body     THE ONLY modality-specific region (markdown <mark> · pdf canvas +
         highlight rects · v2 docx/pptx · v3 image-bbox)
footer   honesty strip, ONLY when degradation requires it
         ("quote not located — showing anyway")
```

Non-modal by design: the consumer hosts the component as a **central overlay**
over its canvas/main view and keeps its side panels live. A new `refs`/`groups`
array (+ `activeIndex`) **retargets** an open viewer — no stacking.

## Purity contract (§S.5(b), CI-gated)

- **Zero graphify dependency**, runtime or type-time. The seam types
  (`CitedSourceRef`, `OntologyCitation`) are a **local mirror of the frozen
  contract** (`src/types.ts`) — re-declared on purpose, never imported. Drift
  is a contract-review event between graphify and the architect.
- **No radar import** (radar's `SignalPdfOverlay`/`pdf-citation-match` was the
  *seed*: lifted, not linked), **no `$lib`/`$app` host-app aliases**.
- **v1 ratified deps only**: `pdfjs-dist` (peer, PDF body), the design system
  (peer), `svelte` (peer). Markdown rendering is self-contained (zero dep).

These are executable gates in `tests/purity.spec.ts` (they scan every `src/`
import and the `package.json` dependency surface) and run in the standard
package test target, so they gate CI wherever the tests run.

## Install

```bash
npm i @sentropic/cited-source-viewer @sentropic/design-system-svelte pdfjs-dist svelte
```

The package ships src-form Svelte 5 sources (same convention as
`@sentropic/chat-ui`): the consumer's bundler compiles the components. The
component is DS-THEMED: it renders DS components + `--st-*` tokens and expects
the host to provide a design-system theme (any `@sentropic/design-system-themes`
theme); every token use carries a neutral fallback so an unthemed host stays
legible.

## Usage

```svelte
<script>
  import CitedSourceViewer from "@sentropic/cited-source-viewer/CitedSourceViewer.svelte";

  const refs = entity.citations.map(toCitedSourceRef); // consumer-side projection

  async function resolveSource(ref) {
    // the viewer NEVER reads bytes itself (§S.3) — the consumer owns fetching
    const url = `sources/${ref.rawRef}`;
    if (ref.rawRef.endsWith(".pdf")) {
      return { kind: "pdf", data: await (await fetch(url)).arrayBuffer() };
    }
    return { kind: "markdown", text: await (await fetch(url)).text() };
  }
</script>

{#if open}
  <div class="my-central-overlay">
    <CitedSourceViewer
      {refs}
      activeIndex={clickedIndex}
      title={entity.label}
      {resolveSource}
      sourceHref={(ref) => `sources/${ref.rawRef}`}
      onClose={() => (open = false)}
      onFocusChange={(f) => highlightChip(f)}
    />
  </div>
{/if}
```

## Public API

### `CitedSourceViewer.svelte` (the frame)

Typed by `CitedSourceViewerProps` in `src/types.ts`.

| Prop | Type | Default | Role |
|---|---|---|---|
| `refs` | `CitedSourceRef[]` | `[]` | Flat citation thread (v1 seam, ungrouped consumers). |
| `groups` | `CitedSourceGroup[] \| null` | `null` | Grouped thread — one group per entity (`{ id, label?, refs }`). Supersedes `refs` when set. |
| `scope` | `"entity" \| "selection"` | `"selection"` | Initial navigation scope. `entity` clamps ‹ Citation x/y › to the active group; `selection` runs over the whole flattened thread. Toggle + ‹ Entité x/y › render only with 2+ groups. |
| `activeIndex` | `number` | `0` | Active ref as a GLOBAL index into the flattened thread. With a new `refs`/`groups` identity it retargets an open viewer. |
| `title` | `string` | `"Cited source"` | Header title. |
| `resolveSource` | `(ref) => Promise<SourcePayload>` | — (required) | §S.3 byte/text resolver, consumer-owned. |
| `sourceHref` | `(ref) => string \| null` | `null` | Raw-source URL for "Ouvrir ↗" (DS Link, new tab). Null/absent hides it. |
| `onClose` | `() => void \| null` | `null` | ✕ + Escape. Hidden/inert when absent. |
| `onFocusChange` | `(focus: CitedSourceFocus) => void` | `null` | Fired on mount and every focus retarget (nav, scope toggle, reopen) with `{ index, ref, scope, groupId, groupIndex, groupRefIndex, docLocator, docIndex, docCount }` — lets the host highlight the matching chip/card (link highlight↔card, §S.4 common behavior). |
| `labels` | `Partial<CitedSourceViewerLabels>` | `{}` | i18n overrides, merged over the qualified defaults (`Citation`, `Doc`, `Page`, `Entité`, `Sélection`, `Ouvrir ↗`, …). |

Events are callback props (Svelte 5 convention — no `createEventDispatcher`).
No slots in v1: the body region is filled by the body-renderer seam below (an
explicit architect decision point — see Open questions #3).

Keyboard: `Escape` → `onClose`; `←`/`→` → page prev/next on page-addressable
bodies. Key events originating in form fields are ignored (non-modal host
panels stay typable).

Toolbar segments auto-collapse: citation nav (2+ refs in scope), scope toggle +
entity nav (2+ groups), doc nav (2+ distinct locators in scope), page + zoom
(page-addressable body only), Ouvrir (href resolved).

### Body-renderer seam (`one UX, many bodies`)

```ts
import { registerBodyRenderer } from "@sentropic/cited-source-viewer";
import DocxBody from "./DocxBody.svelte"; // implements CitedSourceBodyProps

registerBodyRenderer("docx", DocxBody); // v2 plugs in; the frame NEVER changes
```

The frame routes the resolved payload by `payload.kind`:
explicit registry entry → built-in (`markdown`/`text` → `MarkdownBody`, `pdf` →
`PdfBody`) → "unsupported payload kind" error state. Registering an existing
kind **overrides** the built-in (consumer swap, e.g. a richer markdown body).

A body is a Svelte component implementing `CitedSourceBodyProps`:

| Prop | Direction | Role |
|---|---|---|
| `sourceRef`, `payload`, `quote` | frame → body | What to render and what to locate. |
| `scrollContainer` | frame → body | The frame's scroll element (fit-width, scroll-to-highlight). |
| `onStatus(status)` | body → frame | `{ pageAddressable, page?, pageCount?, scale?, canZoomIn?, canZoomOut?, quoteLocated? }` — the frame renders the generic toolbar from this alone. |
| `registerCommands(cmds \| null)` | body → frame | `{ goToPage?, zoomBy?, resetZoom? }` — the toolbar invokes them. |
| `onRenderError(msg)` | body → frame | Body failure → frame error state. |

v2 (DOCX/PPTX) and v3 (image-bbox: draw `bbox`/`region` on an image canvas, no
text match) implement exactly this surface — no frame change. The v3 payload is
whatever kind the consumer resolver returns (e.g. `{ kind: "image", url }`);
the frame never inspects payload internals.

### Pure modules (root export)

```ts
import {
  // seam types (local frozen-contract mirror)
  type CitedSourceRef, type OntologyCitation, type SourcePayload, ...
  // deterministic matcher — "one matcher, two callers" (§S.2)
  findCitationInPage, normalizeForMatch, buildPageText,
  // markdown rendering (escape-safe, <mark> injection)
  renderSourceHtml, escapeHtml,
  // pdf engine (lazy pdf.js singleton + pure geometry)
  loadPdfDocument, renderPdfPage, computeHighlightRects, resolveRenderScale,
  getPdfjs, setPdfWorkerSrc, MIN_RENDER_SCALE, MAX_RENDER_SCALE,
  // body seam
  registerBodyRenderer, unregisterBodyRenderer, getBodyRenderer, registeredBodyKinds,
} from "@sentropic/cited-source-viewer";
```

## The qualified consumer affordance ("Voir la source · p.N")

The full-width **"Voir la source · p.N"** button under a citation quote is the
CONSUMER's side of the qualified UX — deliberately not part of this package
(the package starts at the overlay). The qualified pattern:

- under each citation quote in the host's entity/side panel, a full-width
  affordance labeled `Voir la source · p.N` (or the `source_location` display
  string) opens the central overlay with that citation active
  (`activeIndex` = its global index);
- clicking ANOTHER citation while the overlay is open passes a new
  `refs`/`groups` + `activeIndex` — the open viewer retargets, never stacks;
- `onFocusChange` flows back so the panel highlights the citation/entity the
  viewer is on (both directions stay in sync).

## Works-where matrix

| Context | MD/plain-text body | PDF body |
|---|---|---|
| Served app (http/https, Vite bundle) | ✔ | ✔ — pdf.js worker auto-bundled via the `?url` asset import |
| Static single-file export (`file://`) | ✔ (text inlined by the consumer resolver) | ✖ module workers cannot load over `file://`; the body surfaces a clear load error (sources are not inlined in single-file bundles anyway) |
| Non-Vite bundler | ✔ | ✔ with `setPdfWorkerSrc(url)` called before the first PDF load (the default worker wiring is a Vite `?url` import) |
| jsdom (tests) | ✔ (frame + markdown body fully mountable) | engine covered by pure-geometry tests; pdf.js itself never loads in jsdom |

## Migration notes

- **graphify-studio** (interim `studio/src/components/CitedSourceViewer.svelte`):
  drop the app-local component + `lib/cited-source/*` and depend on this
  package. The seam is identical (`refs`/`resolveSource`/`sourceHref`/
  `activeIndex`/`title`/`onClose` are unchanged); the studio wiring
  (`citationToCitedSourceRef` projection, bundle `sources/` resolver) stays
  app-side. Two interim CSS hooks changed: toolbar buttons are now DS
  `IconButton`/`Button` (assert `st-iconButton` instead of `csv-tb-btn` in
  UAT scripts). The grouped thread (`groups`, scope toggle, `onFocusChange`)
  matches graphify increment 2 — wire EntityPanel chips to `onFocusChange`.
- **immo/radar** (`SignalPdfOverlay.svelte`): this frame is the qualified
  parity target of that overlay (Doc x/y, page nav, − % + zoom with fit-width
  reset, Ouvrir ↗). Replace the bespoke overlay with a thin consumer: resolver
  = `/api/documents/raw` CORS proxy → `{ kind: "pdf", data }`; the radar #82
  geometry split, #83 highlight guard, #81/#85 zoom regimes and #90 fit-width
  reset are preserved in `pdfEngine`/`PdfBody`. `region` fast-path is an open
  question (#5).
- **canevas (RF11 embed)**: host the component in the RF11 citation panel slot;
  provide a resolver over the canevas document store. The non-modal contract
  (host owns the overlay chrome and keeps panels live) matches the RF11 embed
  model; use `labels` for locale alignment.

## Development (monorepo targets)

```bash
make typecheck-cited-source-viewer       # tsc --noEmit
make test-cited-source-viewer            # node-env: quote match, pdf geometry, registry, purity gates
make test-cited-source-viewer-dom        # jsdom: frame + markdown body on real DS components
make build-cited-source-viewer           # tsc dist (pure modules + declarations)
```

Publish wiring (ci.yml validate/publish jobs, npm OIDC trusted publisher,
dist-form pack à la chat-ui) is deliberately deferred until the architect API
review passes.

## Open questions for the architect (API review)

1. **`scope` semantics**: currently an uncontrolled initial value (internal
   toggle state, reported via `onFocusChange`). Should it be fully controlled
   (`bind:scope` / `onScopeChange`) so hosts can drive it?
2. **Doc navigator scoping**: ‹ Doc x/y › is computed over the CURRENT scope's
   thread (entity scope → the active group's documents only). Alternative:
   always global. Which reading matches the qualified immo intent?
3. **Body slot fallback**: unknown payload kinds fail loudly. Should the frame
   also accept a `body` snippet/slot as a consumer escape hatch, or is the
   registry the only extension point (current choice: registry-only, keeps the
   S.6 frame canonical)?
4. **Markdown fidelity**: v1 keeps the interim's self-contained escape-safe
   mini-renderer (zero markdown dep). Upgrade to `markdown-it` in v1.x, or is
   the honest-plain rendering the intended baseline?
5. **`region` fast-path (LM-2c)**: `CitedSourceRef.bbox` is carried but the
   PDF body still highlights via text-match only. Schedule the geometric
   `region` overlay as v2 alongside DOCX/PPTX?
6. **Package name/major**: `0.1.0` until API review; the `enforce-package-bump`
   CI gate applies from the first publish.
