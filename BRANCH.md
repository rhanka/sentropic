# Feature: Agents Surface — chat-ui tabs `agents | chats | comments`

## Objective
- [ ] Sediment the owner's `agents | chats | comments` intention (R1-R15) in `spec/SPEC_EVOL_AGENTS_SURFACE.md`.
- [ ] Ship the additive half of the surface: entry contract, R9 ordering, last-consultation markers, and a design-system-based list component.

## Scope / Guardrails
- [ ] Scope limited to `packages/chat-ui/**`, `spec/**`, and the chat-ui Make targets.
- [ ] Make-only workflow, no direct Docker commands.
- [ ] Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- [ ] Branch development happens in isolated worktree `tmp/chat-agents-surface`.
- [ ] Test campaigns run on `ENV=test-agents`, never on root `dev`.
- [ ] In every `make` command, `ENV=<env>` is passed as the last argument.
- [ ] The breaking tab rename is OUT of this branch: owner GO obtained, but it is an atomic multi-package release scheduled after the shell handover.
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/state/agents*.ts`
  - `packages/chat-ui/src/components/Agents*.svelte`
  - `packages/chat-ui/tests/agents-*`
  - `packages/chat-ui/src/index.ts`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `spec/SPEC_EVOL_AGENTS_SURFACE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `api/**`
  - `packages/cowork-bridge/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `CHAT-AGENTS-EX1`
  - `.github/workflows/**`

## Feedback Loop
- `CHAT-AGENTS-EX1` — **Makefile** (default Forbidden Path).
  - Reason: the owner ratified building the list items on real design-system components, exposed on their own export subpath with the DS as an OPTIONAL peer dependency. `test-chat-ui-dom` installs a fixed package list into a temp dir, so without adding `@sentropic/design-system-svelte` to it the new component cannot be DOM-tested at all. The nearest precedent (`auth-ui`) ships DS-based components with NO DOM coverage; that is below this package's own bar of 13 DOM suites / 189 tests.
  - Impact: one package added to the `test-chat-ui-dom` install list plus one symlink. No other target, no runtime code, no CI workflow, no compose file.
  - Verified: the DS resolves inside the sandbox and the 189 pre-existing DOM tests stay green.
  - Rollback: revert the single Makefile hunk; the component then falls back to the auth-ui precedent (no DOM coverage, since `tsc` does not parse `.svelte`).
- `attention` — **a stale `BRANCH.md` from the infra secret-key lane is committed on `main`** (its "Lot N — Handover" is still unchecked). This branch replaces it per the one-BRANCH.md-per-branch convention, and the convention deletes `BRANCH.md` before merge — which would also remove that residue from `main`. Flagged so it is a decision, not an accident.
- `attention` — arbitration requested from conductor + architect (owner instruction, 2026-07-30): (1) who edits the Chrome/VSCode surfaces for the atomic breaking release, (2) the egress boundary for foreign CLI transcripts. Envelopes deposited and verified on disk; both arbiters were dormant at send time.

- `blocked` — `CHAT-AGENTS-BLK1` — **the design system cannot be compiled by any Svelte-aware bundler at `@sentropic/design-system-svelte@0.34.73`.** Its published `dist/Accordion.svelte` contains `function toggle(id, disabled?)`: the build strips the type annotations AND the `lang="ts"` marker but leaves the optional-parameter `?`, producing a file that declares itself JavaScript while holding TypeScript-only syntax. Evidence: `RollupError: Parse failure: Expected ',', got '?'` at `dist/Accordion.svelte:50:29`. The DS source is correct (`function toggle(id: string, disabled?: boolean)`), so this is a publish-pipeline defect, not a source one. No consumer-side remedy exists: an explicit `vitePreprocess()` changes nothing (nothing marks the script as TS), the package exposes a single `.` export so the broken file cannot be avoided by a deep import, and the failure occurs at IMPORT time so `describe.skip` does not help. The suite is therefore excluded by one line in `vitest.dom.config.ts`; delete that line — nothing else — once a fixed version ships. Reported to the design-system lane.

## AI Flaky tests
- Not applicable: no AI-backed test is touched.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one package, one capability. The cross-surface work (rename, shell handover, api feed) is deliberately deferred to its own lots and lanes.

## UAT Management (in orchestration context)
- **Mono-branch**: the list is not yet mounted in the app, so acceptance here is package-level (DOM/ARIA + unit). Owner UAT comes with the host wiring lot.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Sedimentation**
  - [x] Write `spec/SPEC_EVOL_AGENTS_SURFACE.md` (R1-R15, D1-D21, dependency declination, lots L-A..L-J).
  - [x] Round-1 self-review (Opus) folded in.
  - [x] Round-2 independent adversarial review (Codex `gpt-5.6-sol` xhigh) — verdict RECONSIDER, 11 findings reconciled.
  - [x] Record owner ratifications: breaking major GO, shell returned to the package, awaiting-input sorts first.

- [x] **Lot 1 — Entry contract**
  - [x] `AgentsEntry` union (`agent|session|remote|job|run`), status ladder, `AgentsFeedPort`.
  - [x] Status aggregation across the containment tree.
  - [x] Lot gate: `make test-chat-ui ENV=test-agents`, sabotage-verified (4/7 fail when urgency is inverted).

- [x] **Lot 2 — R9 ordering**
  - [x] Buckets, per-bucket recency key, hierarchical sort, malformed-feed tolerance.
  - [x] Lot gate: 15 tests; a `parentId` cycle bug was caught and fixed.

- [x] **Lot 3 — Last-consultation markers**
  - [x] Built over the existing async `ChatUiStorageAdapter`, principal+workspace namespaced, bounded, monotonic.
  - [x] Lot gate: 12 tests, sabotage-verified (3 fail).

- [x] **Lot 4 — Design-system wiring**
  - [x] Declare `CHAT-AGENTS-EX1` and add the DS to the DOM-test sandbox.
  - [x] Lot gate: 189 pre-existing DOM tests still green with the DS installed.

- [x] **Lot 5 — `AgentsList` component** (delegated to Codex `gpt-5.6-terra` xhigh)
  - [x] Built on `SelectableList`/`SelectableRow`/`StatusDot`/`Tag`/`Badge`/`Avatar`/`OverflowMenu`/`EmptyState` — no hand-written equivalent, no ad-hoc colour.
  - [x] Own export subpath + `.svelte.d.ts`, deliberately NOT re-exported from `src/index.ts` (that entrypoint stays DS-free).
  - [ ] Lot gate: DOM/ARIA tests written but NOT RUNNING — blocked upstream, see `CHAT-AGENTS-BLK1`.

- [x] **Lot 6 — Side-preference accessor**
  - [x] Additive public accessor on the placement menu, unblocking R11's repositionable column.
  - [x] Lot gate: unit test on read/write and full-mode behaviour.
