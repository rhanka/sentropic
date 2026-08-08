# @sentropic/focus

A **focused-session document runtime** — the read-only **FocusSnapshot** render-core for a
*Focus*: a focused working session on a subject, rendered as a renderable, multi-surface document
to orient/steer it (decide being one modality among orient / amend / comment). See
`spec/SPEC_VOL_FOCUS.md`.

This is a **public published package** (`@sentropic/focus`). Its public API is intentionally
small and hosts must provide their own authentication, relayer-provenance, authorization, and
durable Track adapters for live use.

## Scope — Focus-M1 L2 + live signature driver (`feat/focus-live-signature-gate`)

- The **concrete `DecisionDossierDocument` model** — the decision-dossier is the *first* focus
  type, not a generic Focus platform. Node families: `prose`, `question` (q + recommended
  answer/préco + validation state), `optionSet`/`option` (accept|reject|comment annotation),
  `outcome` (modality-tagged), `amendmentTrace`, `diagram`. Every node has a stable id + a
  `targetRef`.
- The **three deterministic renderers**: `renderTerminal`, `renderMd`, `renderHtml` — **HTML is
  mandatory**. Each takes a document and returns a `string`.
- The **`@sentropic/focus/track` binding** maps the real `@sentropic/track/read`
  `DecisionDossierView` + amendment trace with `toDecisionDossierDocument(view)`.
- The fail-closed **`FocusLiveSession` owner-signature driver** accepts only an authenticated,
  authorized own-principal signature for an existing Track-native decision. A co-specified
  production Track adapter with a durable canonical-owner/workspace/decision unique
  constraint or upsert and transactional read-back is required before any live use; the
  in-memory adapter is test-only and cannot establish exactly-once durability.

The **read-only FocusSnapshot** split remains: affordances render as **disabled metadata only**
(no live commands). The live driver requires host-injected authentication, relayer provenance,
authorization, and the durable Track adapter described above.

## Injection + sanitize hooks (no bundled markdown/diagram engine)

Markdown is rendered by **injection**: the HTML renderer takes a host-supplied
`renderMarkdown(md) => string` hook (the package carries **no `marked`** dependency and **no
mdast/rehype core**). HTML is sanitized via a host-supplied `sanitizeHtml(html) => string` hook —
the renderer core owns structure only; hosts own sanitization and styling. The MD renderer emits
prose markdown verbatim by default, with an optional `renderMarkdown` hook for normalization.

**Diagrams = fenced fallback only** (no diagram adapter): a ` ```mermaid ` block in MD, a `<pre>`
in HTML, indented text in the terminal.

## Usage

```ts
import { renderTerminal, renderMd, renderHtml } from "@sentropic/focus";
import { toDecisionDossierDocument } from "@sentropic/focus/track";

const doc = toDecisionDossierDocument(view); // view = real Track DecisionDossierView

const text = renderTerminal(doc);
const md = renderMd(doc);
const html = renderHtml(doc, {
  renderMarkdown: (md) => marked.parse(md), // host supplies marked
  sanitizeHtml: (html) => DOMPurify.sanitize(html), // host supplies the sanitizer
});
```

## Build / checks

```
make typecheck-focus
make test-focus
make build-focus
make pack-focus
```
