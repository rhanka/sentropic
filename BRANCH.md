# Feature: WP-CHAT Wave A — A0a: export-surface contract + rung-1 projection parity

## Objective
Implement the cheap, node-infra-only A0a safety gates for @sentropic/chat-ui: committed export-surface snapshot (export-manifest.json), export-contract vitest tests (subpath resolution + named-export regression oracle + store-shape assertions + consumer scan), rung-1 projection parity (golden ndjson fixtures + deterministic projection tests), and WP-CHAT registration in PLAN.md. Additive only — zero src/app changes.

## Scope / Guardrails
- Scope limited to: `packages/chat-ui/tests/**`, `packages/chat-ui/export-manifest.json`, `packages/chat-ui/tests/fixtures/**`, `BRANCH.md`, `PLAN.md`, `spec/SPEC_EVOL_CHATUI_WAVE_A.md`, `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`, `spec/SPEC_EVOL_CHATUI_TURNKEY_DIALOGUE.md`.
- Make-only workflow, no direct Docker commands.
- Tests run via `make test-chat-ui ENV=test-chatui-a0a` (ephemeral Docker, no dev stack, no ports).
- No src/app changes of any kind. Zero behavior change.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/tests/**`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/tests/fixtures/**`
  - `BRANCH.md`
  - `PLAN.md`
  - `spec/SPEC_EVOL_CHATUI_WAVE_A.md`
  - `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`
  - `spec/SPEC_EVOL_CHATUI_TURNKEY_DIALOGUE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/chat-ui/src/**`
  - `ui/src/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `BR-A0a-EX-candidate` (deferred, attention): **publint + npm-pack consumer fixture + CI export-gate wiring is DEFERRED** to a follow-up branch. These require `.github/workflows/**` (conditional) and possibly `Makefile` (forbidden) edits — needs a `BRxx-EXn` exception process with rationale, impact, and rollback strategy. Out of scope for A0a-branch-1 by design. Owner: conductor, date: post-merge.

## AI Flaky tests
- None in this branch (pure node, deterministic fixtures, no network/model calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: A0a is a single orthogonal lot (manifest + tests + PLAN.md). No sub-workstreams, no CI dependency tree.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only. No user-facing behavior change in A0a — UAT is the green `make test-chat-ui` gate only.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules: `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`
  - [x] Verify worktree is on `feat/chatui-a0a-export-contract`
  - [x] Read spec files: `spec/SPEC_EVOL_CHATUI_WAVE_A.md` (§1.1 + §5), `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md`
  - [x] Confirm `make test-chat-ui` is self-contained (no dev stack, no ENV/ports needed)
  - [x] Confirm scope and guardrails — zero src/app changes
  - [x] Declare `BR-A0a-EX-candidate` for deferred publint/pack/CI-gate work

- [x] **Lot 1 — Deliverables**
  - [x] Generate `packages/chat-ui/export-manifest.json` from `package.json` exports + source grep
  - [x] Create `packages/chat-ui/tests/export-surface.spec.ts`:
    - [x] (a) every exports subpath resolves to an existing file
    - [x] (b) no removed/renamed TS exports (manifest regression oracle)
    - [x] (c) store-shape: chatWidgetLayout + localToolsStore expose subscribe/set/update
    - [x] (d) consumer scan: all ui/src + packages/*/src import specifiers in exports
  - [x] Create `packages/chat-ui/tests/fixtures/streams/simple-assistant-response.ndjson`
  - [x] Create `packages/chat-ui/tests/fixtures/streams/reasoning-then-content.ndjson`
  - [x] Create `packages/chat-ui/tests/fixtures/streams/tool-call-and-result.ndjson`
  - [x] Create `packages/chat-ui/tests/projection.golden.spec.ts` (rung-1 parity)
  - [x] Append WP-CHAT work package to `PLAN.md`
  - [x] Lot gate:
    - [x] `make test-chat-ui ENV=test-chatui-a0a` — 21 files, 167 tests, all pass

- [x] **Lot 2 — Docs and commit**
  - [x] Create `BRANCH.md`
  - [x] Commit 1: BRANCH.md + spec files + PLAN.md
  - [x] Commit 2: export-manifest.json + export-surface.spec.ts
  - [x] Commit 3: projection fixtures (ndjson) + projection.golden.spec.ts
  - [x] Push and open PR

- [ ] **Lot N — Final validation**
  - [ ] `make test-chat-ui ENV=test-chatui-a0a` — reconfirm green on final HEAD
  - [ ] Final gate: create/update PR using `BRANCH.md` as PR body
  - [ ] Once CI green: commit removal of `BRANCH.md`, push, merge
