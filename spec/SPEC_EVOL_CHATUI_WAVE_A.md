# SPEC_EVOL — chat-ui Wave A (headless UI-core extraction, parity harness, radar P1-P3)

Status: SPEC v2 — post double review (**Codex gpt-5.5/xhigh = REVISE**, **Opus 4.8 = REVISE**), findings applied. Ready for owner go (or a third re-challenge on request).
Parent plan: `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md` (v2). Scope = **Wave A only** (A0a/A0b → A1 → A2 → A3). Later waves & carve-outs (voice, canvas, React/Vue bindings, T4-T8) are referenced, not specified here.
Baseline: `main` (re-validate all `AppChatPanel.svelte` line refs at branch creation — they were checked on the `uat/39c` worktree and are **approximate**). Owner: `sentropic-chat`. Risk tiers per parent §5.

## 0. Goal & non-goals (Wave A)

Goal: stand up the cheap safety nets first, extract a **UI-only** headless core **behind unchanged `@sentropic/chat-ui` exports**, retrofit the app where 1:1, and deliver radar's P1-P3 ergonomics from the lib — proving the operating model on Svelte before any second framework.

Non-goals: no React/Vue binding; no `ChatConversation` turnkey (Wave B); no voice/canvas; no theming restyle (tokenization after A3); **no orchestration moved out of the app**; no breaking export change. **Deferred from parent §8 to later waves** (explicit): cross-framework SSR/hydration parity (only SvelteKit SSR smoke here), observability/error-taxonomy surface, axe-automation maturity, full per-entrypoint bundle-budget CI gate (Wave A only asserts "no consumer bundle increase from re-export").

## 1. A0 — Safety nets, split by cost

### 1.1 A0a — cheap gates on EXISTING infra (no new tooling, no Makefile change) — blocks A1
- **Export manifest**: committed `packages/chat-ui/export-manifest.json` generated from `package.json` `exports` (the current ~25 subpaths) + each subpath's named exports + **Svelte component prop names via `svelte-check`/source extraction** (NOT the excluded `.d.ts`, which can drift). Checker target fails on any removed/renamed export or prop. Includes a **store-shape assertion**: subpaths exporting a store (e.g. `stores/chatWidgetLayout`, `stores/localTools`) must expose `subscribe` (+ `set`/`update`) — catches store-identity regressions invisible to name-only snapshots.
- **`publint`** + **npm-pack consumer fixture** that imports every subpath and type-checks. The fixture enumerates **all in-repo consumers**: `ui/src/**` **and `packages/*/src/**`** (e.g. `packages/cowork-desktop` imports chat-ui directly).
- **Rung-1 parity**: golden **stream fixtures** (`tests/fixtures/streams/*.ndjson`, captured real SSE) → deterministic core-projection tests under the **existing `--environment node` vitest** target. Zero new infra.
- Register `WP-CHAT` in root `PLAN.md`; add characterization tests of current projection/smoothing/local-tool pause-resume as the regression oracle.

### 1.2 A0b — heavy harness, separately budgeted (declare `BR-EXn` for Makefile) — gates A3 visual/DOM claims only, NOT A1
- **Spike FIRST**: prove a Svelte 5 component renders in vitest+jsdom (today `tsconfig` excludes `.svelte`, target runs `--environment node`, app's `@testing-library/svelte@4` is Svelte-4-era). Declare exact devDeps (`jsdom`, `@testing-library/svelte@^5`, vitest Svelte plugin + config). If the spike is flaky/blocked → escalate (rung-2/3 become their own lot).
- **Rung-2**: semantic DOM/ARIA/interaction tests per component over the golden fixtures.
- **Rung-3**: bounded screenshots — decide tooling (Storybook vs `@playwright/experimental-ct` vs a static `/stories` SvelteKit route); fixed states, dynamic content masked, 2 viewports (390/1280), documented tolerance, flake-triage owner. Doubles as the cross-app sameness reference for radar.
- New Make targets here touch the **default-forbidden `Makefile`** → **`BR-EXn`** (rationale/impact/rollback) required before this lot.

## 2. A1 — UI-only core extraction (Tier-1) with explicit ownership matrix

**Export ownership matrix** (corrects the "core absorbs browser/runtime" contradiction):

| Module | Lands in | Rationale |
|---|---|---|
| `state/*`, `utils/*`, `renderers/registry` | **`@sentropic/chat-ui-core`** (headless) | framework-pure TS (verified: no svelte imports) |
| local-tool **UI state machine** (reducer extracted from `stores/localTools`) | **core** | pure transitions |
| `stores/localTools` host side (Chrome/VSCode runtime lookup, tool catalogs, permission RPC message names, mutation, `setLocalToolsAdapter`) | **chat-ui façade** behind a **host-adapter/RPC boundary** | browser/runtime-coupled |
| `client/transport` (fetch/SSE), `client/streamHub` (EventSource, extension proxy ports, `window.location`), `hosts/createWebHost` | **chat-ui façade** (browser-client layer, NOT headless core) | browser wire |
| Svelte components (`components/*.svelte`) | **chat-ui façade** | Svelte |

- **Move shared types first**: `state/chatWidgetShell` currently type-imports `ChatWidgetDisplayMode` from the store module → relocate the type to core, break the edge.
- **`chatWidgetLayout`: do NOT de-Svelte in Wave A.** Keep the literal exported `writable` singleton (15 lines, no reducers; 4 live auto-sub surfaces: `+layout.svelte`, `Toast.svelte`, `Header.svelte`, set in `ChatWidget.svelte`). Revisit later if ever needed.
- **`localTools`: extract the state-machine/reducer into core**; keep host lookup + RPC + mutation in the façade adapter; add **permission/RPC security regression tests** (execute transitions `executing → awaiting_permission/completed/failed`; `decideLocalToolPermission`).
- `@sentropic/chat-ui` re-exports **every** current subpath verbatim from core/façade.
- Gates: A0a export-snapshot zero-diff + store-shape assertions + core unit tests + rung-1 projection parity + full chat e2e on `ENV=e2e-chatui-core` (isolated). **Version: `chat-ui-core@0.1.0`; `chat-ui@0.2.0` depends on `chat-ui-core@~0.1.0`** (regular dep, so published-pin consumers resolve it); rollback pin = `chat-ui@0.1.1`.

## 3. A2 — gate, not a code lot (folded into A1 exit)

The app imports **deep subpaths only** (no barrel), so "retrofit onto the façade" changes no specifier — it is a **resolution + behavior gate**: A0a contract test proves every `ui/src/**` (+ `packages/*/src/**`) subpath still resolves; delete app duplicates **only** where a *new* A3 primitive verbatim-replaces them (expect ~0 in A2). Gate = full chat e2e (`03-chat`, `08-chat-heavy`, mobile, extension) on isolated env + **owner visual smoke of live `AppChatPanel`** (Tier-1; the app consumes via `file:../packages/chat-ui` → no semver buffer → changes reach prod on rebuild).

## 4. A3 — radar P1-P3 (precise contracts; each = additive lib Tier-0 + app-retrofit Tier-1)

- **P1 `ModelSelector`** — **preserve native `<select>` semantics** (source is `<select id="chat-model-selection">`, NOT a custom listbox): props `{ models, value (bind, 'provider::model'), grouping, fallback }`, change event, auto-width; i18n via resolver; native-select a11y (no custom ARIA widget). Source ≈ `AppChatPanel.svelte:3934-3989,5467-5489` (re-validate on `main`).
- **P2 `MessageActions`** — **message subset ONLY** (copy/edit/regenerate/retry/feedback for an assistant/user message). Define **action variants + event payloads**; handlers injected as callbacks/events; **comment copy/edit + checkpoint-restore stay in `AppChatPanel`** (app-owned per SDK boundary). Re-derive the precise sub-range on `main` (cited 4630-4915 is conflated with comment logic).
- **P3 `ChatContextProvider` port + `ContextChips`** — publish an interface that **returns already-resolved chip data**; **route detection + entity-label loading stay app-owned**. Neutral `ChatContextEntry { type: string; id?: string; label: string; active?; used?; lastUsedAt? }`; default no-op provider + empty chips. **Cross-repo: radar signs off the neutral shape via `neg:chat-librarization-radar` before P3 merges**; prove Sentropic's `context-provider.ts` is assignable to the published interface.

## 5. Test plan (file granularity)
- A0a: `packages/chat-ui/tests/export-surface.spec.ts` (manifest+props+store-shape), `packages/chat-ui/tests/pack-consumer.fixture/*`, `packages/chat-ui-core/tests/projection.spec.ts` (golden fixtures), characterization specs.
- A0b: `packages/chat-ui/tests/dom/*.dom.spec.ts` (jsdom), `packages/chat-ui/stories/*` + `tests/visual/gallery.spec.ts`.
- A1: `packages/chat-ui-core/tests/local-tools-statemachine.spec.ts` (+ permission/RPC regression).
- A3: `packages/chat-ui/tests/dom/{model-selector,message-actions,context-chips}.dom.spec.ts`.
- Updated: `ui/tests/*` wrappers; `e2e/tests/03-chat.spec.ts`; SvelteKit **SSR/hydration smoke** for the chat route.
- Commands (ENV last) — note `make test-ui` runs the **app** suite; **package** tests run via the chat-ui package target (A0b adds a jsdom-capable target under `BR-EXn`): `make test-chat-ui ENV=test-chatui-core`; `make clean test-e2e API_PORT=… UI_PORT=… MAILDEV_UI_PORT=… ENV=e2e-chatui-core`.

## 6. Branch series (off `main`, small, incrementally mergeable; app-consuming ⇒ Tier-1)
1. `feat/chatui-a0a-export-contract` (Tier-1 gate infra; node infra only).
2. `feat/chatui-a0a-parity-rung1` (golden fixtures + projection + PLAN.md WP-CHAT).
3. `feat/chatui-a0b-dom-visual-harness` (**BR-EXn** Makefile; spike-gated).
4. `feat/chatui-core-extract` (A1, Tier-1) — ownership matrix + types-first + localTools reducer + façade re-export.
5. `feat/chatui-model-selector-p1` (lib Tier-0) → `…-p1-retrofit` (app Tier-1).
6. `feat/chatui-message-actions-p2` (lib Tier-0) → retrofit (Tier-1).
7. `feat/chatui-context-provider-p3` (lib Tier-0; **blocked on radar sign-off**) → retrofit (Tier-1).

## 7. h2a alignment
- radar `neg:chat-librarization-radar`: P1-P3 land in Wave A → counteroffer target `@sentropic/chat-ui@0.2.x` after A3; P4/P6/P7 Wave B; P5 Wave C. **P3 needs radar sign-off on the neutral context interface before merge.**
- DS: open `chat-ui × DS` nego before tokenization (post-A3).
- mermaid: `ChatConversation` is Wave B; this spec stabilizes the core it will compose.

## 8. Cross-cutting acceptance (Wave A)
a11y on P1-P3 (native-select semantics for P1; keyboard/focus/live-region for streaming-touched DOM; axe where A0b exists); preserve label injection via the real `ChatUiLabelResolver`/`StreamMessageLabelResolver` (not `ChatUiLabelDictionary`) + new i18n keys, RTL-safe; **local-tool permission/RPC security regression** (A1); **SvelteKit SSR/hydration smoke** for the chat route; bundle: re-export must not increase consumer bundle. (Cross-framework SSR, observability, axe-maturity, full bundle-budget CI → later waves.)

## 9. Review log
Codex gpt-5.5/xhigh → REVISE (A0 enforceability, core ownership matrix, A3 tiers/contracts). Opus 4.8 → REVISE (A0a/A0b split, `chatWidgetLayout` identity, P2/P3 coupling, version matrix). Both applied above; no fundamental rethink (verdicts were REVISE, not RECONSIDER).
