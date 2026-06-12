# SPEC_EVOL — reusable "Read the Docs" documentation template (DS docs skeleton + chat-ui powered search)

## 0. Status & lineage
- **Status**: PROPOSAL (draft PR) — submitted for evaluation by `claude:architect`. Nothing is built in sentropic yet; this spec + the scaffold under `spec/docs-template-scaffold/` are the whole deliverable.
- **Authored by** `claude:sent-tech-design-system` (the DS maintainer agent), on owner instruction: turn the DS docs skeleton into a reusable Read-the-Docs-style template, with **search powered by a chat-ui module**; **first client = dataviz.sent-tech.ca**.
- **Companion PR** (same proposal, DS side): rhanka/sent-tech-design-system **#24** — `docs/docs-template-extraction.md` (genericity inventory + extension points) + a working scaffold of the search module (`apps/docs/src/lib/chat/DocsSearch.svelte`, `docs-search-index.ts`, 9 vitest tests, svelte-check 0 errors).
- **Grounding**: line-level reconnaissance of `sent-tech-design-system/apps/docs` (NodeSpec engine, 5 tenant chromes, chat widget wire contract, URL-driven theme/framework state, FR/EN i18n, adapter-static prerender of 250+ routes) and of `dataviz/apps/site` (declarative demo registry, AppChrome consumption, hand-rolled 62-line SPA router, no search / no i18n / Svelte-only live demos).
- **Relationship to existing packages**: complementary to `@sentropic/chat-ui` (the search module's conversational stage speaks the same "external chat endpoint" pattern; a `chat-server` + `llm-mesh` backend is the natural production endpoint). No overlap with `ui/` (the sentropic app) — this is a static docs-site skeleton.

## 1. Goal & non-goals
- **Goal**: any team shipping a component library or a UI product (DS, dataviz, future tenants) composes `docs-template + their content source + their component registry + optional chromes` and gets a complete documentation site: tri-framework live examples (Svelte inline + React/Vue islands), themed chrome, sidebar/nav/breadcrumb derived from one catalog, FR/EN i18n, theme+framework carried in the URL, static prerender, a chat assistant, and **search with conversational escalation**.
- **Non-goals**:
  - Moving DS-specific content (component catalog data, tenant chromes Airbus/Canada/Carbon/DSFR/Quebec, theme-compare tooling) into the template. Content stays client-side; the template owns only mechanisms.
  - Replacing sentropic's own `spec/`-based engineering docs. This template targets public product/library documentation sites.
  - A CMS or markdown pipeline (v1 keeps the existing "pages are Svelte routes + declarative catalog" model; full-text markdown indexing is an open question, §8).

## 2. Target architecture
- **One publishable package** (working name `@sentropic/docs-template`; name + home are open questions, §8) exposing:
  - `engine/` — the NodeSpec DSL (`NodeSpec`, `ComponentNodeSpec`, `ElementNodeSpec`), `nodeToCode` serializers, `SvelteNode` inline renderer, React/Vue island mounters (`IslandHandle { unmount() }`), `TabbedExample` / `FrameworkPreview` demo shells. **Dependency inversion**: the `ComponentName -> implementation` table becomes an injected registry (per framework) instead of hard imports of `@sentropic/design-system-{svelte,react,vue}`.
  - `content/` — the content-source contracts (`ComponentEntry`, `CategoryGroup`, `DocsNavItem`) + derivations (sidebar groups, breadcrumb, prerender entries, search index). Clients provide the data; the template provides every derivation.
  - `state/` — URL-as-source-of-truth stores (theme, framework, locale, color mode) with anti-FOUC bootstrap and re-stamping on navigation; valid theme/framework lists are client-provided.
  - `chrome/` — the docs chrome **contract** (typed props: `children`, `activeThemeId`, theme/framework/locale switcher snippets, mobile menu) + one default chrome built on the already-published `AppChrome`/`AppHeader` DS components. Tenant chromes remain client code implementing the contract.
  - `search/` — the chat-ui powered search module (§5).
  - `chat/` — the assistant widget (launcher + panel, anonymous-gating counter, wire contract `{ messages[], locale } -> { reply }` against a configurable external endpoint).
- **Clients**:
  - `sent-tech-design-system/apps/docs` becomes consumer #0 (dogfooding; its current code is the reference implementation being extracted).
  - `dataviz/apps/site` becomes consumer #1 (§6).

## 3. Behavior-ownership boundary
Same rule as `SPEC_EVOL_CHATUI_MODULARIZATION.md` §3, transposed: a unit of code belongs in the **TEMPLATE** iff every docs site wants it *identically* (render a NodeSpec tree in 3 frameworks, derive a sidebar from a catalog, stamp theme+framework into the URL, score a lexical query, escalate to the chat endpoint). It belongs in the **CLIENT** iff it encodes a product fact (which components exist, their descriptions, tenant chrome visuals, valid theme list, demo datasets, rich page prose). The template must build and render with a FAKE registry containing zero `@sentropic/design-system-*` imports.

## 4. Typed contracts (drafted from real call-sites; to be ratified)
Extracted verbatim-shape from `apps/docs` (see `spec/docs-template-scaffold/contracts.ts` for the compilable version):

```ts
// engine — declarative tri-framework example tree
type NodeSpec = string | ComponentNodeSpec | ElementNodeSpec;
interface ComponentNodeSpec { comp: string; props?: Record<string, unknown>; children?: NodeSpec[] }
interface ElementNodeSpec { el: string; props?: Record<string, unknown>; children?: NodeSpec[] }
interface ComponentRegistry<TComponent> { resolve(name: string): TComponent | undefined }
interface IslandHandle { unmount(): void }

// content — one catalog drives nav + breadcrumb + prerender + search
interface ComponentEntry {
  name: string; slug: string;
  status: "documented" | "stub";
  category: string; groupSlug?: string;
  description: LocalizedText; // { fr, en } today; locale set is client config
}

// search — the indexable unit (client derives docs from its catalog/registry)
interface DocsSearchDocument {
  id: string; url: string;
  kind: "component" | "guide" | "view";
  title: LocalizedText; excerpt: LocalizedText; keywords: string[];
}

// chat wire — shared by assistant widget AND search escalation
interface ChatRequestBody { messages: { role: "user"|"assistant"|"system"; content: string }[]; locale: string }
interface ChatResponseBody { reply?: string }
```

## 5. Chat-ui powered search (the differentiator vs plain RTD)
Two stages, designed for fully static sites (no server runtime):
1. **Lexical stage** (instant, free, offline): a static index derived at build time from the client's content source; pure scoring function (accent-insensitive, AND semantics, title > keywords > excerpt). Already implemented and tested in DS PR #24 (`searchDocs`, 9 tests).
2. **Conversational stage** (opt-in): "Ask the assistant" wraps the query + top lexical hits (title, URL, excerpt) into a grounded prompt (`buildAssistantPrompt`) and POSTs it to the SAME configurable endpoint as the chat widget (`PUBLIC_CHAT_ENDPOINT`, wire contract §4). Client-side RAG: grounding travels in the message; the backend stays free. Natural production backend: `@sentropic/chat-server` + `@sentropic/llm-mesh` behind that URL; the docs feedback-platform plan (login-free RP OAuth + graphify chatbot) plugs in here.
- Degradation is total and graceful: no endpoint configured -> lexical search fully functional, escalation shows an explicit notice. No hard blocking anywhere (same philosophy as the existing anonymous-gated chat widget).

## 6. First client: dataviz (needs analysis)
What dataviz already has that maps 1:1 onto the template:
- a **declarative registry** (`DemoEntry { slug, section, name, group, tagline, useCase, demo, code.{svelte,react,vue} }`) = the template's content source;
- **AppChrome + DS tokens** everywhere (4 tenants switchable) = the default chrome works as-is;
- a framework switcher store = the template's URL-driven framework state, minus the URL part.

What dataviz lacks today and gets from the template (gaps observed in `apps/site`):
| Gap | Template answer |
| --- | --- |
| No search at all (58+ pages, manual navigation) | lexical index derived from its registry + conversational escalation |
| FR-only, no i18n mechanism | FR/EN copy pattern + locale store |
| Live demos are Svelte-only (code tabs show 3 frameworks, render shows 1) | React/Vue island mounters |
| Hand-rolled SPA router, no static prerender, no deep-linkable theme/framework | SvelteKit adapter-static skeleton + URL state |
| No versioned docs | open question §8 (shared with DS) |

Stays dataviz-specific: demo dataset (700 rows), BI stores (dataviz-core), registry entries, tenant list.

## 7. Scaffold in this PR
`spec/docs-template-scaffold/` — illustration only, deliberately OUTSIDE `packages/` so no CI path-filter triggers and nothing joins the build:
- `README.md` — target package layout + file-by-file mapping to the reference implementation in `sent-tech-design-system/apps/docs`;
- `contracts.ts` — the §4 contracts, compilable standalone (zero imports).

## 8. Open questions for the architect (decisions requested)
1. **Package home**: (a) `sentropic/packages/docs-template` (next to chat-ui, benefits from CI/publish lanes), (b) stays in the DS repo as a sibling package, or (c) a dedicated repo? Authoring gravity is in the DS repo today; publish/governance gravity is here.
2. **Name**: `@sentropic/docs-template`? `@sentropic/docs-kit`?
3. **Versioning**: independent semver pinning a DS version for the default chrome (like dataviz does), or lockstep with the DS? (DS lockstep has bitten before.)
4. **Search index depth for v1**: catalog-derived index (shipped, cheap) vs build-time full-text extraction of rich page prose? The contract (`DocsSearchDocument`) is the same either way.
5. **Conversational backend**: standardize on `chat-server` + `llm-mesh` behind `PUBLIC_CHAT_ENDPOINT` for both DS docs and dataviz docs (one shared deployment?), or per-site endpoints? Server-side grounding (backend indexes the docs) vs the shipped client-side grounding?
6. **Versioned docs** (RTD's flagship feature): in scope for the template v2 (route prefix per version + version switcher in chrome), or out of scope?
7. **Process**: if GO, this graduates from spec to a numbered `plan/NN-BRANCH_feat-docs-template.md` with lots (extract engine -> extract state/content -> search -> dataviz adoption). Who owns the branch — DS side or sentropic side?

## 9. Delivery sketch (post-GO, indicative)
1. Lot 1 — dependency inversion inside `apps/docs` (registry injection), zero visible change; gate = existing docs build + checks.
2. Lot 2 — extract `engine/ content/ state/ chrome/ chat/ search/` into the package; `apps/docs` consumes it (dogfooding); gate = docs site byte-comparable prerender.
3. Lot 3 — dataviz adoption: registry -> content source, tenants -> URL state, islands for React/Vue live demos, search on. Gate = dataviz.sent-tech.ca parity + new features live.
