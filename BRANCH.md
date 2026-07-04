# Feature: @sentropic/cited-source-viewer — Lot 2 first cut (architect §S.5/§S.6)

## Objective
Create the shared cited-source viewer package `packages/cited-source-viewer` (`@sentropic/cited-source-viewer`), porting the qualified graphify interim implementation (CitedSourceViewer + quoteMatch/markdownSource/pdfEngine) into a pure, DS-themed, DS-component-based package with a pluggable body-renderer seam (v1 = MD + PDF text-layer), purity gates as tests, and the extended §S.6 API (grouped thread, scope toggle, focus events).

## Scope / Guardrails
- Scope limited to `packages/cited-source-viewer/**` (+ this `BRANCH.md`, + the additive Makefile targets under exception BR-CSV-EX1).
- No publish, no merge, no push before the architect API review (this branch stays in the worktree).
- No graphify runtime dependency — seam types are re-declared locally (frozen-contract mirror), enforced by a purity test gate.
- v1 ratified deps only: `pdfjs-dist` (peer) + self-contained markdown rendering (zero markdown dep) + `@sentropic/design-system-svelte` (peer) + `svelte` (peer).
- Make-only workflow for gates (docker ephemeral-install pattern, mirroring chat-ui targets).
- Branch development in isolated worktree `tmp/cited-source-viewer-lot2`.
- All new text in English (UI default labels carry the principal-qualified French toolbar strings, overridable via `labels`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cited-source-viewer/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `e2e/**`, other `packages/*`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BR-CSV-EX1 below)
  - `.github/workflows/**` (NOT touched in this branch — CI validate/publish wiring is a follow-up after architect API review)
- **Exception process**:
  - BR-CSV-EX1 declared in `## Feedback Loop` before touching `Makefile`.

## Feedback Loop
- `attention` — **BR-CSV-EX1 (Makefile, additive only)**: add `typecheck-cited-source-viewer`, `test-cited-source-viewer`, `test-cited-source-viewer-dom`, `build-cited-source-viewer` targets mirroring the existing chat-ui docker ephemeral-install pattern (BR-A0b-EX1 precedent). Reason: the repo is Make-only; a new package is untestable "with the monorepo's tooling" without its targets. Impact: additive targets only, no existing target modified, no compose change. Rollback: delete the four targets.
- `attention` — publish/pack wiring (`publish-cited-source-viewer`, ci.yml `validate-…`/`publish-…` jobs, npm OIDC trusted-publisher bootstrap) is deliberately NOT in this branch: the package public API is ARCHITECT-owned and must pass API review first (task mandate: no publish before reporting).
- `attention` — open API questions for the architect are consolidated in `packages/cited-source-viewer/README.md` §Open questions.
- `attention` — **upstream finding (affects other packages)**: svelte **5.55.7**'s ESM compiler build (`import 'svelte/compiler'`, the path vite/vitest use) fails to strip TypeScript optional-parameter markers (`foo?`) from `lang="ts"` components while stripping other annotations — compiled node_modules Svelte libs (design-system dist, svelte-streamdown dist) become invalid JS in vite SSR pipelines ("Parse failure: Expected ',', got '?'"). The CJS build strips correctly; svelte 5.56.x fixes the ESM build. The `test-cited-source-viewer-dom` target pins `svelte@5.56.4` (within the workspace `^5.55.7` override). The chat-ui dom target is LATENTLY exposed (svelte-streamdown dist Elements contain `lang="ts"`); recommend bumping its pin too (separate branch).

## AI Flaky tests
- None expected (no LLM/network in tests; pdf.js is never loaded in tests — pure-geometry coverage only).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single new package, no cross-service change, one test cycle.

## UAT Management (in orchestration context)
- No app UAT in this branch (library-only). The S.6 frame UX was principal-qualified on 2026-07-04 on the graphify interim; this port pins the same UX with frame tests. Consumer UAT happens at adapter time (graphify-studio / immo / canevas).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/design-system.md`, chat-ui package as structural reference.
  - [x] Create isolated worktree `tmp/cited-source-viewer-lot2` (branch `feat/cited-source-viewer-lot2` from `main`).
  - [x] Locate the DS: `@sentropic/design-system-svelte` (npm, built in the sibling `sent-tech-design-system` repo) — Button/IconButton/ContentSwitcher/Link/Badge available.
  - [x] Confirm scope boundaries; declare BR-CSV-EX1.
- [ ] **Lot 1 — Package port + extended frame**
  - [x] `src/types.ts` — local frozen-contract mirror (CitedSourceRef/OntologyCitation) + viewer/body seam types.
  - [x] `src/quoteMatch.ts`, `src/markdownSource.ts`, `src/pdfEngine.ts` — TS ports of the graphify pure libs (logic unchanged).
  - [x] `src/bodies/registry.ts` + `MarkdownBody.svelte` + `PdfBody.svelte` — body-renderer seam (v2/v3 plug in without touching the frame).
  - [x] `src/CitedSourceViewer.svelte` — S.6 frame on REAL DS components, extended API (groups[], scope, onFocusChange, entity nav).
  - [x] `src/index.ts` + `*.svelte.d.ts` + `package.json` + `tsconfig.json` + `svelte.config.js` + `vitest.dom.config.ts`.
  - [x] Lot gate:
    - [x] `make typecheck-cited-source-viewer` (PASS, docker)
    - [x] **Package tests**
      - [x] `tests/quote-match.spec.ts` (port + extension of graphify citedSourceQuoteMatch)
      - [x] `tests/pdf-geometry.spec.ts` (port of graphify citedSourcePdfEngine pure geometry)
      - [x] `tests/body-registry.spec.ts` (seam registration/override)
      - [x] `tests/purity.spec.ts` (no-graphify / no-radar / no-$lib / ratified-deps gates)
      - [x] `tests/viewer-frame.dom.spec.ts` (toolbar nav, doc grouping, groups/scope/focus, DS-component presence)
      - [x] Sub-lot gate: `make test-cited-source-viewer` (22/22) + `make test-cited-source-viewer-dom` (17/17)
    - [x] `make build-cited-source-viewer` (PASS, dist emitted)
- [x] **Lot N-1 — Docs consolidation**
  - [x] `packages/cited-source-viewer/README.md` — API surface, S.5/S.6 conditions, consumer affordance pattern, works-where matrix, migration notes (graphify-studio / immo SignalPdfOverlay / canevas RF11), open API questions.
- [ ] **Lot N — Final validation**
  - [x] Re-run all four make gates; record real outputs in the report to the architect.
  - [x] Version stays 0.1.0 (new package; `enforce-package-bump` satisfied by the initial version).
  - [ ] STOP: report to conductor/architect — no PR, no push, no publish from this branch without explicit go.
