# Feature: ChatContextPicker — faithful extraction of sentropic's context picker (Wave 2)

## Objective
Extract sentropic's REAL composer context picker (the vertical icon+label, active/inactive toggle list + optional extension active-tab row) into a canonical, domain-neutral `@sentropic/chat-ui` component `ChatContextPicker`, and make sentropic consume it with **ZERO UX change** (byte-identical rendered markup). Canonical replacement for the orphan `ContextChips` (radar migrates later, Wave 3). See `spec/SPEC_EVOL_CHATUI_FIDELITY.md` §4.1 + §5.

## Scope / Guardrails
- Make-only; ENV last; worktree `tmp/chatui-context-picker`; never `ENV=dev`; never `make clean-all`.
- ZERO UX change is the hard contract: the app's context picker must render identical DOM after the swap.
- All text English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/src/components/ChatContextPicker.svelte` (+ `.d.ts`)
  - `packages/chat-ui/src/state/chat-context.ts` (only if a neutral type addition is needed — additive)
  - `packages/chat-ui/package.json` (add export + version bump 0.9.0 -> 0.10.0)
  - `packages/chat-ui/chat-ui-reference-validation.json` (add ChatContextPicker = primitive dogfooded)
  - `packages/chat-ui/tests/**` (DOM markup-parity test)
  - `ui/src/lib/components/chat/AppChatPanel.svelte` (consume in the context block ~5608-5650)
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `packages/chat-ui/src/components/ContextChips.svelte` (leave legacy orphan untouched)
  - other `ui/**` files, `api/**`
- **Exception process**: declare `BR-FID2-EXn` in `## Feedback Loop` before touching any forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Accept only non-systematic flakiness; never add timeouts. (e2e suite currently flaky across groups — re-run, don't chase.)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] Multi-branch
- Rationale: one faithful extraction + its dogfood consumer.

## UAT Management
- ZERO UX change → no new UAT surface. Proof: (a) ChatContextPicker DOM markup-parity test asserts the exact classes/structure of the old inline block; (b) chat e2e group 03 (composer menu) green; (c) diff review shows the app block markup is preserved (moved into component + slot).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Worktree `tmp/chatui-context-picker` on `feat/chatui-context-picker`; ENV `feat-chatui-picker`; ports API 9310, UI 5410, MAILDEV 1310.
  - [x] Read the EXACT current context block in `ui/src/lib/components/chat/AppChatPanel.svelte` (`{#if contextEntries.length === 0 && !extensionActiveTabContext}` ... `{:else}` ... `{/if}`, ~5608-5650), `getContextIcon` (~380: organization→Building2, folder→Folder, initiative→Lightbulb, executive_summary→ScrollText, else FileText), `toggleContextActive` (~2025), `sortedContexts` (~2012: `[...contextEntries]`), and the app `ChatContextEntry` shape in `ui/src/lib/chat/context-provider.ts` ({contextType, contextId?, label, active, used, lastUsedAt:number}). Read the lib neutral `ChatContextEntry` in `packages/chat-ui/src/state/chat-context.ts` ({type, id?, label, active?, used?, lastUsedAt?:string}).

- [x] **Lot 1 — ChatContextPicker component (canonical, neutral)**
  - [x] Create `packages/chat-ui/src/components/ChatContextPicker.svelte` (Svelte 4 `export let` style, matching ContextChips conventions) rendering EXACTLY the app's current inner block: container `<div class="space-y-1 overflow-auto slim-scroll" style={maxHeightStyle}>`, an optional `<slot name="leading" />` (for the app's extension active-tab row), then `{#each entries as e (e.type + ':' + (e.id ?? ''))}` a `<button class="flex w-full items-center gap-2 rounded px-1 py-1 text-[11px] hover:bg-slate-50 {e.active ? 'text-slate-900' : 'text-slate-400'}" type="button" on:click={() => onToggle?.(e)}>` with `<svelte:component this={iconFor?.(e)} class="w-4 h-4" />` + `<span class="truncate max-w-[220px]">{e.label}</span>`.
  - [x] Props: `entries: ChatContextEntry[]` (neutral), `iconFor?: (e) => unknown`, `onToggle?: (e) => void`, `labels?: ChatUiLabelResolver`, `maxHeightStyle?: string`.
  - [x] Add `.d.ts`; export `./components/ChatContextPicker.svelte` in `package.json`; bump `version` 0.9.0 -> 0.10.0 (minor, additive).
  - [x] Add manifest entry `ChatContextPicker.svelte` = `primitive`, `dogfoodedBy: ["ui/src/lib/components/chat/AppChatPanel.svelte"]` in `chat-ui-reference-validation.json`.
  - [x] DOM markup-parity test `packages/chat-ui/tests/chat-context-picker.dom.spec.ts`: mount with active+inactive entries + an iconFor; assert container classes, per-button classes incl. the active/inactive conditional, icon presence, label span+truncate — matching the documented old markup exactly.

- [x] **Lot 2 — sentropic consumes it (ZERO UX change)**
  - [x] In `AppChatPanel.svelte`, replace the `{:else}` inner block (container + activeTab row + `{#each sortedContexts}`) with `<ChatContextPicker>` from `@sentropic/chat-ui/components/ChatContextPicker.svelte`: `entries={sortedContexts.map(adaptToNeutral)}`, `iconFor={(e) => getContextIcon(e.type)}`, `onToggle={(e) => toggleContextActive(findAppEntry(e))}`, `maxHeightStyle={composerMenuContextsMaxH || 'max-height:10rem'}`, with `slot="leading"` holding the EXISTING extension active-tab row markup (Globe + `chat.context.activeTabPrefix`) unchanged. Keep the outer `{#if empty}none{:else}...{/if}` + the section title in the app.
  - [x] `adaptToNeutral(c)`: `{ type: c.contextType, id: c.contextId, label: c.label, active: c.active, used: c.used, lastUsedAt: c.lastUsedAt > 0 ? new Date(c.lastUsedAt).toISOString() : undefined }`. `findAppEntry(e)`: `contextEntries.find(c => c.contextType === e.type && c.contextId === e.id)`. Keep `getContextIcon`/`toggleContextActive`/`sortedContexts` in the app.
  - [x] Confirm produced DOM is identical (diff review: same classes/order/attributes). Any unavoidable difference => STOP + Feedback Loop (do not ship a visual change).
  - [x] Lot gate: `make typecheck-ui ENV=feat-chatui-picker`, `make lint-ui ENV=feat-chatui-picker`, full chat-ui subset (typecheck/build/pack/unit/dom), `make build-ui-image ENV=feat-chatui-picker`. e2e via PR CI (chat group 03).

- [ ] **Lot N — Final validation**
  - [ ] All local gates green; `enforce-package-bump` satisfied (chat-ui bumped 0.10.0).
  - [ ] PR (this BRANCH.md content as body), branch CI green (ALL; re-run e2e flakes — never merge red).
  - [ ] Remove BRANCH.md, push, merge.
