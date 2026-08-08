# Feature: L-C-shell — incremental app→package shell handover (header-first, D1c)

## Objective
Hand the chat widget shell over from the app to `@sentropic/chat-ui` in header-first, one-shippable-slice steps so the PACKAGE owns the tab bar + list and the app stops taking over `renderShell` — the prerequisite that makes the later R1 rename (L-A') visible. No rename, no `api/` change, no visible behavior change in this lot.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**` and `ui/**`; `api/**` stays untouched.
- No R1 rename here: `ChatWidgetTab` literals, user-visible labels, persisted coercion and handoff schema stay unchanged (that is L-A').
- Every slice additive → `chat-ui` minor bump; baseline is ONE cumulative minor for the whole lot (`0.33.0` → `0.34.0`).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` reserved for owner dev/UAT (`ENV=dev`); never run test campaigns there.
- Branch development happens only in `tmp/chat-lc-shell`.
- Unit/DOM gates on `ENV=test`; E2E on `ENV=e2e-lc-shell`, isolated ports, never root `dev`.
- In every `make` command, `ENV=<env>` is the last argument.
- Touching `ui/**` → run the FULL `make test-ui` before push, not just the changed file.
- All new text English; owner UAT in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/components/ChatWidget.svelte`
  - `packages/chat-ui/src/components/ChatWidget.svelte.d.ts`
  - `packages/chat-ui/src/components/ChatWidgetTabBar.svelte` (new — extracted tab-bar primitive)
  - `packages/chat-ui/src/components/ChatWidgetTabBar.svelte.d.ts` (new)
  - `packages/chat-ui/src/components/AgentsList.svelte`
  - `packages/chat-ui/package.json`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/chat-ui-reference-validation.json`
  - `packages/chat-ui/tests/**` (DOM + reference-validation contracts for the new seams)
  - `ui/src/lib/components/ChatWidget.svelte`
  - `ui/src/lib/components/ChatPanel.svelte`
  - `ui/tests/components/chat/**`
  - `ui/src/locales/en.json`, `ui/src/locales/fr.json`
  - `e2e/tests/03-chat.spec.ts`, `e2e/tests/08-chat-workspace-switch.spec.ts`, `e2e/tests/08-chat-checkpoint-restore.spec.ts` (non-regression selectors only, if the shell DOM shifts)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `packages/cowork-bridge/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit `BRxx-EXn`)**:
  - `.github/workflows/**` (none expected)
- **Exception process**:
  - Declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path (reason + impact + rollback).

## Feedback Loop
- `clarification` — Q1 QueueMonitor ownership: baseline = stays APP-LOCAL behind the existing `renderJobsPanel` for all of L-C-shell (no retire/redesign). Package boundary test forbids importing `QueueMonitor`; honored.
- `clarification` — Q2 transition mechanism: baseline = keep `renderShell?: Snippet<[]>` source-compatible for external consumers; this app stops PASSING it at S8; the package gains supported header/content subcomponents. No break in a minor.
- `clarification` — Q3 header generic-vs-host boundary: baseline = ALL current trailing controls (settings `MenuPopover`, side-switch, placement, close) stay in one host `renderHeaderActions` snippet; no generic close/placement moves package-side in this lot.
- `clarification` — Q4 D13 state ownership: baseline = FROZEN — `agentsView` stays app-owned, `cowork-bridge` untouched. This lot moves DOM ownership only, not view-state ownership.
- `clarification` — Q5 release cadence: baseline = ONE cumulative `chat-ui` minor (`0.33.0` → `0.34.0`) for the whole lot in one PR (8 atomic commits), not a published per-slice series.
- `attention` — DS DOM blocker to re-check before S5/S6: the AgentsList DOM suite recorded a design-system parse blocker (`packages/chat-ui/tests/agents-list.dom.spec.ts`). Re-verify at S5; if still present, cover S5/S6 with package source + host-wiring fail-first tests and do not green a DOM-acceptance that was not executed.
- `attention` — F5 (typed bubble/wheel glyph) stays blocked on the design-system lane; interim `layers` icon in `AgentsList` is unchanged by this lot.

## AI Flaky tests
- Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (one success on same commit+command). Never add timeouts. Record command + file + signature here. Owner sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single lane, incremental slices, one final test cycle)
- [ ] **Multi-branch**
- Rationale: one owning lane (chat), strictly ordered slices on a shared file, one cumulative minor — no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- Mono-branch: UAT on the integrated branch after the shell handover is complete, from root `ENV=dev` with owner data. Invariant is "no visible change" — UAT is a NON-regression pass of the current agents-surface (list-default, Back+slide, hybrid mount, all header controls, tab order/labels).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Fresh worktree `tmp/chat-lc-shell` from `origin/main` (chat-ui `0.33.0`).
  - [x] Ground on ratified D1c and the L-C lot row (`spec/SPEC_EVOL_AGENTS_SURFACE.md`).
  - [x] Lock the 5 fork baselines (Q1–Q5 above) and scope boundaries.
  - [ ] Confirm env/ports: unit/DOM on `ENV=test`; E2E slot `ENV=e2e-lc-shell` API_PORT=9106 UI_PORT=5306 MAILDEV_UI_PORT=1206.

- [ ] **Lot S1 — move the live tab bar, not a façade (≤145 lines)**
  - [ ] Extract the app tab-bar literals/labels/callbacks into a package `ChatWidgetTabBar` primitive; replace the app's three buttons; keep the surrounding app header; app opts out of the package default jobs badge (preserve I4).
  - [ ] Lot gate:
    - [ ] `make typecheck-ui` + `make lint-ui`
    - [ ] **UI tests**
      - [ ] Package DOM (fail-first): `ChatWidgetTabBar` asserts current three-role order, `showCommentsTab` predicate, click callback, badge-off parity → `make test-chat-ui-dom ENV=test`
      - [ ] Host-wiring (fail-first): the app header imports the primitive and no longer owns the three buttons → `make test-ui SCOPE=tests/components/chat/ChatWidget-shell.test.ts ENV=test`
      - [ ] Sub-lot gate: FULL `make test-ui ENV=test`
    - [ ] `chat-ui` minor bump + export/reference-validation entry for `ChatWidgetTabBar`

- [ ] **Lot S2 — package header frame, host controls as slots (≤145 lines)**
  - [ ] Add `renderHeaderLeading`, `renderHeaderActions`, `headerGrip`; wrap existing mobile/action blocks as in-place host snippets (no move/reindent of the settings popover).
  - [ ] Lot gate: typecheck+lint; package DOM proves leading→tab→actions order + grip pointer callback; host-wiring proves every existing action still injected; FULL `make test-ui ENV=test`.

- [ ] **Lot S3 — package tab-content routing, host panels unchanged (≤120 lines)**
  - [ ] Introduce the narrow package content compositor; feed existing jobs/comments/chat snippets; `QueueMonitor` stays inside the jobs snippet (app-only per boundary test).
  - [ ] Lot gate: typecheck+lint; package DOM selects each tab and sees only its injected panel; host-wiring proves `<QueueMonitor />` still app-only; FULL `make test-ui ENV=test`.

- [ ] **Lot S4 — cut conversation host seams in place (≤130 lines)**
  - [ ] Make configured `ChatSessionsBar` a `renderConversationHeader` snippet and `<ChatPanel>` a `renderChatPanel` snippet; keep menu/Plus/Trash host snippets; no composer code moves.
  - [ ] Lot gate: typecheck+lint; host-wiring asserts header/body slot placement + Back/menu/icon wiring; keep existing Back DOM contract; preserve mounted `chatPanelRef`; FULL `make test-ui ENV=test`.

- [ ] **Lot S5 — package agents pager prepared (≤145 lines)**
  - [ ] Add package-owned list section + conversation container around shipped `AgentsList` with `agentsList` object, `renderAgentsListHeader`, `renderConversationHeader`, `renderChatPanel`, announcement prop; move the logical slide/reduced-motion CSS into the package.
  - [ ] Re-check the DS DOM blocker first (see Feedback Loop).
  - [ ] Lot gate: typecheck+lint; package DOM/structure proves list conditional mount, conversation persistent-mount/hidden, slot placement, live region; FULL `make test-ui ENV=test`.

- [ ] **Lot S6 — switch the live pager to package ownership (≤145 lines)**
  - [ ] Replace the app list/conversation wrapper with the package pager; remove the direct app `<AgentsList>` mount and app-owned motion CSS.
  - [ ] Lot gate: typecheck+lint; evolve host test to reject direct `<AgentsList>` ownership while asserting Option-3, Back/focus, row actions, package pager props; FULL `make test-ui ENV=test`.

- [ ] **Lot S7 — narrow the extension gate (≤130 lines)**
  - [ ] Wrap only loading/auth/onboarding in `renderContentGate({ renderReady })`; host calls `renderReady` in its `{:else}` branch.
  - [ ] Lot gate: typecheck+lint; package DOM proves a host gate suppresses ready content and renders it exactly once; host-wiring asserts all three states/actions remain; FULL `make test-ui ENV=test`.

- [ ] **Lot S8 — remove this app's full-shell takeover (≤120 lines)**
  - [ ] Promote prepared header/content snippets to the `PackageChatWidget` call; stop passing `renderShell`; package `ChatWidget` composes header + tab bar + gate + panel routing + list. Keep `renderShell` available to external consumers.
  - [ ] Lot gate: typecheck+lint; app anti-takeover test expects no `renderShell={renderAppChatWidgetShell}`; package DOM renders header + selected panel/list via the default path; FULL `make test-ui ENV=test`.

- [ ] **Lot N-2 — UAT (non-regression, root `ENV=dev`, owner data)**
  - [ ] Web app: agents list is default when sessions exist and none active; conversation when active/none; Back→slide + focus; hybrid mount; tab order/labels unchanged; all header controls (settings, side-switch, placement, close) present; jobs/comments panels unchanged.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Fold the D1c handover end-state into `spec/SPEC_EVOL_AGENTS_SURFACE.md` (mark L-C-shell shipped; L-A' still pending owner GO).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (ui + chat-ui)
  - [ ] FULL `make test-ui ENV=test` + `make test-chat-ui-dom ENV=test` + `make test-chat-ui ENV=test`
  - [ ] E2E non-regression: `make clean test-e2e E2E_SPEC=tests/03-chat.spec.ts API_PORT=9106 UI_PORT=5306 MAILDEV_UI_PORT=1206 ENV=e2e-lc-shell` (03 on AI allowlist) + 08 workspace-switch/checkpoint-restore
  - [ ] `chat-ui` cumulative minor `0.34.0` verified > npm published
  - [ ] PR body = this `BRANCH.md`; CI green (AI shards non-blocking allowlist)
  - [ ] Owner UAT sign-off + owner GO recorded; then remove `BRANCH.md`, push, merge (`--merge` only)
