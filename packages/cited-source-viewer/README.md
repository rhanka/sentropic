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
toolbar  [Entité|Sélection] · ‹ Citation x/y › · ‹ Entité x/y › (Sélection)
         · ‹ Doc x/y › · ‹ Page x/y › · − NN% + · Ouvrir ↗
         (one compact DS bar)
quote    the active citation quote (blockquote strip)
body     THE ONLY modality-specific region (markdown <mark> · pdf canvas +
         highlight rects · v2 docx/pptx · v3 image-bbox)
footer   honesty strip, ONLY when degradation requires it
         ("quote not located — showing anyway")
```

Non-modal by design: the consumer hosts the component as a **central overlay**
over its canvas/main view and keeps its side panels live. A new `refs`/`groups`
array (+ `activeGroupIndex` and group-relative `activeIndex`) **retargets** an
open viewer — no stacking.

The default behavior is graphify-iso. Sentropic keeps only neutral architecture
extensions around that behavior: `labels`, `class`, the body registry, the
closed v1 payload union, and generic body props. With defaults, the visible UX
and primary callbacks match the Graphify-qualified viewer.

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
      onFocusChange={(groupId, refIndex) => highlightChip(groupId, refIndex)}
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
| `scope` | `"entity" \| "selection"` | `"entity"` | Initial navigation scope. `entity` clamps ‹ Citation x/y › to the active group; `selection` runs over the whole flattened thread. The toggle renders only when 2+ groups carry refs. |
| `activeGroupIndex` | `number` | `0` | Active group seed when `groups` is present. |
| `activeIndex` | `number` | `0` | Active ref seed. In flat mode this indexes `refs`; with `groups`, it is relative to `groups[activeGroupIndex].refs`. |
| `title` | `string` | `"Cited source"` | Header fallback. In grouped mode the visible title follows the active group label + locator. |
| `resolveSource` | `ResolveSource<SourcePayloadBase>` | — (required) | §S.3 byte/text resolver, consumer-owned. A v1 resolver returns the closed `SourcePayload` union (`pdf` \| `markdown`/`text` — full narrowing); a resolver feeding custom bodies widens explicitly (`ResolveSource<SourcePayload \| DocxPayload>`). |
| `sourceHref` | `(ref) => string \| null` | `null` | Raw-source URL for "Ouvrir ↗" (DS Link, new tab). Null/absent hides it. |
| `onClose` | `() => void \| null` | `null` | ✕ + Escape. Hidden/inert when absent. |
| `onScopeChange` | `(scope) => void` | `null` | Fired when the user toggles Entité/Sélection. |
| `onFocusChange` | `(groupId, refIndex) => void` | `null` | Primary graphify callback. Fired only from in-viewer navigation; `refIndex` is group-relative. It is not fired on mount or prop-driven retarget. |
| `onFocusDetail` | `(focus: CitedSourceFocus) => void` | `null` | Optional Sentropic extension for the same navigation events, with `{ index, ref, scope, groupId, groupIndex, groupRefIndex, docLocator, docIndex, docCount }`. |
| `labels` | `Partial<CitedSourceViewerLabels>` | `{}` | i18n overrides, merged over the qualified defaults (`Citation`, `Doc`, `Page`, `Entité`, `Sélection`, `Ouvrir ↗`, …). |
| `class` | `string` | `""` | Extra class(es) appended to the frame's root `<section class="csv">` (host layout hook). |

Events are callback props (Svelte 5 convention — no `createEventDispatcher`).
No slots in v1: the body region is filled by the body-renderer seam below (an
explicit architect decision point — see Open questions #3).

Keyboard: `Escape` → `onClose`; `←`/`→` → page prev/next on page-addressable
bodies; `n`/`N` → next/previous citation in the active scope; `e`/`E` →
next/previous entity in Sélection scope only. Key events originating in form
fields are ignored (non-modal host panels stay typable).

Toolbar segments auto-collapse: citation nav (2+ refs in scope), scope toggle
(2+ groups carrying refs), entity nav (Sélection scope only), doc nav (2+
distinct locators in scope), page + zoom (page-addressable body only), Ouvrir
(href resolved).

### Body-renderer seam (`one UX, many bodies`)

```ts
import { registerBodyRenderer, type CitedSourceBodyComponent } from "@sentropic/cited-source-viewer";
import DocxBody from "./DocxBody.svelte"; // Component<CitedSourceBodyProps<DocxPayload>>

// v2 plugs in; the frame NEVER changes. The cast is the DOCUMENTED seam
// boundary: a concrete body is typed against ITS payload, narrower than the
// base-typed registry slot (Svelte props are contravariant). Runtime safety
// holds because the frame only mounts the body for its registered `kind`.
registerBodyRenderer("docx", DocxBody as unknown as CitedSourceBodyComponent);
```

The frame routes the resolved payload by `payload.kind`:
explicit registry entry → built-in (`markdown`/`text` → `MarkdownBody`, `pdf` →
`PdfBody`) → "unsupported payload kind" error state. Registering an existing
kind **overrides** the built-in (consumer swap, e.g. a richer markdown body).

**Payload typing (architect touch 1)**: `SourcePayload` is the CLOSED v1
discriminated union (`PdfSourcePayload | TextSourcePayload`) — `payload.kind`
narrows fully. Custom kinds never widen the union: a v2/v3 body declares its
own payload type extending `SourcePayloadBase` (`{ kind: string }`), and the
body props are generic over it.

A body is a Svelte component implementing `CitedSourceBodyProps<P>` (with `P`
its concrete payload type — `TextSourcePayload` for the markdown body,
`PdfSourcePayload` for the pdf body):

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
  (`activeIndex` = flat index in flat mode, or `activeGroupIndex` +
  group-relative `activeIndex` in grouped mode);
- clicking ANOTHER citation while the overlay is open passes a new
  `refs`/`groups` + active indexes — the open viewer retargets, never stacks;
- `onFocusChange(groupId, refIndex)` flows back from in-viewer navigation so
  the panel highlights the citation/entity the viewer is on.

## Works-where matrix

| Context | MD/plain-text body | PDF body |
|---|---|---|
| Served app (http/https, Vite bundle) | ✔ | ✔ — pdf.js worker auto-bundled via the `?url` asset import |
| Static single-file export (`file://`) | ✔ (text inlined by the consumer resolver) | ✖ module workers cannot load over `file://`; the body surfaces a clear load error (sources are not inlined in single-file bundles anyway) |
| Non-Vite bundler | ✔ | ✔ with `setPdfWorkerSrc(url)` called before the first PDF load (the default worker wiring is a Vite `?url` import) |
| jsdom (tests) | ✔ (frame + markdown body fully mountable) | engine covered by pure-geometry tests; pdf.js itself never loads in jsdom |

### Markdown body — rendering scope (deliberately PARTIAL)

The v1 markdown body uses a self-contained, escape-safe mini-renderer (zero
markdown dependency — the interim's qualified behavior). Its feature scope is
intentionally narrow; everything outside it renders as escaped plain text
(safe and legible, never broken markup):

| Markdown feature | Rendered? | As |
|---|---|---|
| Headings `#`–`######` | ✔ | `<h3>`–`<h6>` (demoted two levels) |
| `**bold**` / `*italic*` | ✔ | `<strong>` / `<em>` |
| Paragraphs / line breaks | ✔ | `<p>` / `<br>` |
| Quote highlight | ✔ | `<mark data-csv-mark>` on the located range |
| Inline HTML in the source | ✔ escaped | shown literally (XSS-safe, `{@html}`-proof) |
| Lists (`-`, `1.`) | ✖ | escaped plain text |
| Links / images | ✖ | escaped plain text (no navigation, no fetch) |
| Inline code / code blocks | ✖ | escaped plain text |
| Tables / blockquotes / hr | ✖ | escaped plain text |

Upgrading to a full renderer (`markdown-it`) is an architect-owned v1.x
decision (Open question #4) and would be a body-internal change — the seam
does not move. A consumer can also override the `markdown` kind with its own
richer body via `registerBodyRenderer`.

## Migration notes

- **graphify-studio** (interim `studio/src/components/CitedSourceViewer.svelte`):
  drop the app-local component + `lib/cited-source/*` and depend on this
  package. The behavioral seam is graphify-iso: `refs`, `groups`,
  `activeGroupIndex`, group-relative `activeIndex`, `scope`, `resolveSource`,
  `sourceHref`, `title`, `onClose`, `onFocusChange(groupId, refIndex)`, and
  `onScopeChange(scope)`. The studio wiring (`citationToCitedSourceRef`
  projection, bundle `sources/` resolver) stays app-side. Two interim CSS hooks
  changed: toolbar buttons are now DS `IconButton`/`Button` (assert
  `st-iconButton` instead of `csv-tb-btn` in UAT scripts). `labels`, `class`,
  `onFocusDetail`, and the body registry are package extensions; leaving them
  unused preserves Graphify's qualified behavior.
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

1. **Scope control beyond graphify-iso**: v1 matches Graphify: `scope` is an
   initial/retarget prop, internal toolbar toggles call `onScopeChange(scope)`,
   and `onFocusChange` is not used for scope reporting. A future fully
   controlled `bind:scope` API would be additive and requires separate review.
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
5. **`region` fast-path (LM-2c)**: `CitedSourceRef.bbox`/`region` are carried
   but the PDF body still highlights via text-match only. Schedule the
   geometric `region` overlay as v2 alongside DOCX/PPTX?
6. **Package name/major**: `0.2.0` carries the graphify-iso API realignment;
   the `enforce-package-bump` CI gate applies from the first publish.
