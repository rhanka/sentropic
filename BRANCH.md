# Feature: BR-41 Cowork Registration Umbrella (documentation-only)

## Objective
Register and document two sequenced feature branches — BR-41a (`feat/cowork-desktop-tools`) and BR-41b (`feat/cowork-local-webview`) — that introduce "Sentropic Cowork": a portable, all-TypeScript Windows binary (zip, no installer) providing desktop tools (eyes/hands) to the Sentropic agent, reusing the Chrome-plugin enrollment and local-tool protocol via a published client bridge. This branch is documentation-only: it adds the BR-41 study (`spec/SPEC_COWORK.md`), the three plan files, and the `PLAN.md` registration. No code changes.

## Scope / Guardrails
- Scope limited to plan files, the Cowork study spec, and the `PLAN.md` registry.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/chore-cowork`.
- No code, no migration, no test changes in this branch.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_COWORK.md`
  - `plan/41-BRANCH_chore-cowork.md`
  - `plan/41a-BRANCH_feat-cowork-desktop-tools.md`
  - `plan/41b-BRANCH_feat-cowork-local-webview.md`
  - `PLAN.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - any `api/**`, `ui/**`, `packages/**`, `e2e/**`
  - other `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - none

## Feedback Loop
- **BR41-Q1** `attention`: code-signing strategy for the portable binary (unsigned → SmartScreen/AV warnings) — deferred decision, tracked in BR-41a plan, not blocking registration.

## AI Flaky tests
- N/A — documentation-only branch, no automated tests.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (documentation-only; no code; no CI dependency)
- [ ] **Multi-branch**
- Rationale: this branch only registers and documents BR-41a/b. The two registered branches are themselves sequenced multi-branch (BR-41b depends on the bridge BR-41a publishes), but that sequencing is executed after this chore merges.

## UAT Management (in orchestration context)
- N/A — no user-facing changes in this branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `README.md`, `PLAN.md`, `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm branch `chore/cowork`, worktree `tmp/chore-cowork` (`git -C tmp/chore-cowork branch --show-current`).
  - [ ] Confirm scope and guardrails (docs-only).

- [ ] **Lot 1 — Cowork study spec**
  - [ ] Create `spec/SPEC_COWORK.md` (architecture, bridge, device-code enrollment, desktop tool protocol, portable-binary packaging, BR-41a/b split, risks).
  - [ ] Lot gate: review the spec for internal consistency and alignment with the existing Chrome-plugin and packages conventions.

- [ ] **Lot 2 — Branch plan files**
  - [ ] Create `plan/41-BRANCH_chore-cowork.md` (umbrella registration, mirroring BR-40 pattern).
  - [ ] Create `plan/41a-BRANCH_feat-cowork-desktop-tools.md` (detailed, from `plan/BRANCH_TEMPLATE.md`).
  - [ ] Create `plan/41b-BRANCH_feat-cowork-local-webview.md` (detailed, from `plan/BRANCH_TEMPLATE.md`).
  - [ ] Lot gate: review the three plan files for consistency, port allocation, and dependency direction (41b depends on 41a bridge).

- [ ] **Lot 3 — PLAN.md registration**
  - [ ] Add a status addendum (2026-05-25) summarizing BR-41a/b.
  - [ ] Add catalog rows for BR-41a and BR-41b after BR-40c.
  - [ ] Lot gate: review `PLAN.md` for table formatting and consistency.

- [ ] **Lot N — Final validation**
  - [ ] Review all created/changed files for consistency and no contradictions.
  - [ ] Create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Verify branch CI on that PR and resolve remaining blockers.
  - [ ] Once CI OK, commit removal of `BRANCH.md`, push, and merge via merge commit.
  - [ ] After merge: spawn BR-41a worktree and begin Lot 0.
