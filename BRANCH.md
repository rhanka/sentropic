# Feature: Freeze the chat migration contract (P0)

## Objective
- [ ] Freeze the approved P0 behavior, ownership, consumer and styling contract without changing implementation.
- [x] Source: approved 2026-10-28 plan, SHA-256 `daf1d8373fa0eaedc3514c452e8161cd597b9c3a749772ca94334e5cede08790`; Opus r2 APPROVE.

## Scope / Guardrails
- [x] Documentation only under `spec/`; branch execution checklist in `BRANCH.md`.
- [x] Branch `feat/chat-convergence-p0` from `origin/main`; worktree `tmp/worktrees/chat-p0`.
- [x] Base `ea20bd9c026e9717d911514e763f8911b6981dde`; no runtime, UI, dependency, release or data change.
- [x] Make-only commands; `ENV=test-chat-p0` last; no containers or port allocation required.
- [x] Root workspace and its uncommitted Track state remain untouched.
- [x] Atomic commits of at most 150 changed lines via `make commit`; selective staging; no AI trailers.
- [x] Merge only if integration becomes necessary; never rebase; deliver a draft PR without merging.
- [x] All new documentation, commit and PR text in English.
- [x] Owner tests, UAT GO, transfer GO and npm authorization remain separate gates.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `spec/CHAT_MIGRATION_P0*.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `plan/**`
  - [x] `packages/**`
  - [x] `ui/**`
  - [x] `api/**`
  - [x] `.github/**`
  - [x] `.track/**`
  - [x] Receiving DS repository (read-only evidence).
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None authorized; a newly required path needs a bounded `BRP0-EXn` first.
- [x] **Exception process**:
  - [x] Record rationale, impact and rollback in Feedback Loop before any exception edit.

## Feedback Loop
- [x] `BRP0-N1` clarification: P0 documents a proposed C-03 amendment; only DS may edit its contract.
- [x] `BRP0-N2` clarification: the plan author/reviewer evidence does not acknowledge this new contract for either domain maintainer.
- [x] `BRP0-N3` clarification: inventory and draft PR are authorized; no owner UAT or transfer approval is inferred.
- [x] `BRP0-N4` clarification: local scope gate uses installed host harness through an external make overlay and skips `build-harness`; no tracked Makefile edit or Docker needed.
- [x] `BRP0-R1` acknowledge: boundary review APPROVE; clarify estimate proposal versus approved summary, and split mixed DOM/stream-fixture test custody (conductor refresh before P1).
- [x] `BRP0-R2a` acknowledge: broaden consumer census to all case-insensitive chat-ui references; add CI manifests/wiring, E2E storage/regressions and retained historical mentions.
- [x] `BRP0-R2b` acknowledge: selector locations now identify the first selector token; first atomic correction slice complete.

## AI Flaky tests
- [x] Not applicable: no application tests changed or executed; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one documentation author; independent review is read-only; no cherry-pick.
- [ ] **Multi-branch**: not required for this single lot.
- [x] Rationale: one approved P0 contract with several evidence appendices.

## UAT Management (in orchestration context)
- [x] Web, Chrome and VSCode behavior unchanged; P0 UAT is documentary inspection.
- [x] Future U0 retains the owner's personal tests on exact integrated artifacts and two verbatim GO decisions.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project rules, template, approved plan and r2 review; verify plan hash.
  - [x] Create isolated branch/worktree and mechanically check its exact branch with harness.
  - [x] Record documentation-only environment, scope and existing source baseline.
- [x] **Lot P0a — Inventory and classify**
  - [x] Enumerate 125 global CSS selector blocks affecting chat and inherited host styling.
  - [x] Inventory all package files/exports, consumers, styling overrides and app widget snippets.
  - [x] Record appendix: symbols inventory.
  - [x] Record appendix: edges inventory.
  - [x] Record appendix: consumers inventory.
  - [x] Record appendix: support inventory.
  - [x] Record appendix: exports inventory.
  - [x] Record appendix: sources inventory.
  - [x] Assign reusable visual, Sentropic runtime or justified host responsibility to every path.
  - [x] Build behavior/owner/test matrix and transitive runtime relocation map.
- [ ] **Lot P0b — Reconcile and freeze**
  - [x] Reconcile ECOSYSTEM, TURNKEY, SURFACES, PLAN_CHAT_SURFACES, AGENTS_SURFACE and #602/UAT-1.
  - [x] Inspect published DS theme/Drawer artifacts and name canonical DS chat primitives; assign missing DropZone to F15.
  - [x] Record all section 6 conductor defaults and owner-held gates without impersonating owner decisions.
  - [x] Integrate r2 notes: runtime package/semver break, proposed C-03 owner/copy changes, M1b release dependency, split estimate.
  - [x] Record domain acknowledgement state and bounded next-owner acceptance criteria.
- [ ] **Lot P0c — Final validation and draft PR**
  - [x] Validate exhaustive inventories against the pinned source; inspect every diff hunk.
  - [ ] Verify whitespace and allowed paths; mechanically check branch/scope before each commit.
  - [ ] Independent contract/evidence reviews and finding reconciliation.
  - [x] Create draft PR to `main`, body from this checklist, with execution-plan comment (PR #816).
  - [ ] Push and verify CI completed/success on exact final head; report PR and full SHA.
  - [x] API/UI/E2E test files: none changed; documentation-only checks plus repository CI qualify P0.
  - [x] No package version bump required; no `packages/*/src/**` changes.
  - [x] No Docker lifecycle required; no containers started.
  - [x] Keep `BRANCH.md` for draft review; deletion/merge is outside this delivery.
