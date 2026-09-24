# Feature: CI publishable manifest guard — Lot G SPEC

## Objective
- [ ] Deliver the design for cluster-mesh CI lint, packed-manifest enforcement, and clean consumer installation qualification.

## Scope / Guardrails
- [x] Planning only on `ci/publishable-manifest-guard`, worktree `tmp/ci-manifest-guard`; baseline `273bff382` equals local `origin/main` at entry.
- [x] No implementation, dependency changes, publication, push, PR, merge, or edits outside this worktree.
- [x] Make-only checks; Docker-first; no Python; English text; `ENV` last; no `ENV=dev` or `clean-all`.
- [x] Environment: `test-ci-manifest-guard`; reserved cleanup mapping API `9435`, UI `5635`, Maildev UI `1535`; no services required.
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `spec/SPEC_EVOL_CI_PUBLISHABLE_MANIFEST_GUARD.md`
  - [x] `BRANCH.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `.github/workflows/**`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `packages/**`, `scripts/**`, `api/**`, `ui/**`, `e2e/**`
  - [x] `package.json`, `package-lock.json`, `rules/**`, `plan/**`, `PLAN.md`, `.track/**`
  - [x] Every path outside the two Allowed Paths.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**: none in SPEC.
- [x] **Exception process**: propose `BRCI-EXn` with reason, impact, rollback for BUILD only; no exception is activated here.

## Feedback Loop
- [x] BRCI-A1 | attention | Owner: conductor | Branch: current | 2026-09-24 | Reversible: use BLOCK for changed/publish-selected packages and WARN for unrelated published packages, preserving the conductor's rollout decision.
- [x] BRCI-A2 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | Install replays are mandatory BUILD closure evidence; SPEC cannot add or execute the nonexistent target. Expected: two successful reports; actual: pending implementation.
- [x] BRCI-A3 | attention | Owner: conductor | Branch: current | 2026-09-24 | This two-file scope excludes harness/track recorder writes; branch and scope checks remain mandatory. Independent review precedes conductor push/PR/merge.
- [x] BRCI-A4 | attention | Owner: BUILD conductor | Branch: current | 2026-09-24 | Reversible: full candidate packs for BLOCK, lifecycle-free inventory snapshots for WARN; avoids unrelated native builds while every actual publication remains strict.

## AI Flaky tests
- [x] Not applicable: documentation-only; no AI or runtime tests are executed or waived.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author; no integration, cherry-pick, or delegated writes.
- [x] Multi-branch implementation planning is owned by the conductor after SPEC review.

## UAT Management (in orchestration context)
- [x] Web, Chrome, VSCode UAT: not applicable to this design-only lot.
- [ ] Consumer acceptance: specify published mcp-auth `0.2.1` and cluster-mesh `0.11.0` replays and evidence fields for BUILD.

## Plan / Todo (lot-based)
- [x] **Lot G0 — Baseline and rule**
  - [x] Read mandatory rules, template, root workspace declaration, Makefile recipes, and CI publication structure; mechanical branch check passes.
  - [x] Create this scoped branch plan first.
  - [x] Document npm root cause, strict dependency rule, packed-artifact boundary, and placement recommendation in the new spec.
- [ ] **Lot G1 — Exact BUILD contract**
  - [x] Specify root lint target, guard targets, CI jobs/steps, classification algorithm, and forbidden-spec regex.
  - [ ] Specify clean install isolation, entry point imports, published/tarball inputs, and failure reporting.
- [ ] **Lot G2 — Acceptance and handoff**
  - [ ] List file-level BUILD tests, exception requests, rollout sequence, known offenders, and unresolved owner decisions.
  - [ ] Consolidate the standalone EVOL spec and review all design requirements against repository evidence.
  - [ ] Run `make scope-check ENV=test-ci-manifest-guard` before each commit; inspect staged diff; commit only the two allowed files.
  - [ ] Run cleanup with the recorded ports, confirm clean worktree, and report exact checks plus `git log --oneline origin/main..HEAD`.
