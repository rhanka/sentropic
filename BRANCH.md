# Feature: Canvas live H0 contract and consumer preparation

## Objective
- [x] Execute only H0 of the approved host plan (SHA-256 `f130f04c4597b483b089ef5b3b6d6d9502b61a36111859f62f835b37c9bc19e2`).
- [x] Prepare evidence for existing Canvas L2-CB3 integration; no behavior change or adoption claim.

## Scope / Guardrails
- [x] Base: `origin/main` at `5e986a0b6cd2dfecfbde6a588d30055271124696`; branch `feat/canvas-live-h0`.
- [x] Isolated worktree: `tmp/worktrees/canvas-h0`; root dev/UAT stays reserved for the owner.
- [x] English documents and data only; no migrations, dependencies, runtime code or Python.
- [x] Make-only commands, `ENV` last; selective staging then separate `make commit`; each commit at most 150 changed lines.
- [x] Merge only when later authorized; never rebase; no AI trailers.
- [x] No service stack required; reserved test mapping: `ENV=test-canvas-h0`, API `9400`, UI `5600`, Maildev UI `1500` (not started).
- [x] Preserve the frozen DS contract; do not create a second descriptor, vocabulary, generator or binding.
- [x] All future behavior witnesses are RED-first; H0 records inputs and pending gates only.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/canvas-live/**`
  - `api/tests/fixtures/canvas-live/**`
  - `ui/tests/fixtures/canvas-live/**`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `api/src/**`
  - `ui/src/**`
  - `packages/**`
  - `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- [x] **Exception process**: record `BRH0-EXn`, rationale, impact and rollback before any exception; none required.

## Feedback Loop
- [x] Q-CL-1, Q-B1-4, list profile, FE-3/FE-6 and preserved-block eligibility remain adoption gates; H0 must not settle them.
- [x] DS publication, export qualification and N1–N8 deletion evidence remain pending until measured by their adoption owners.
- [x] Apply Opus r2 notes touching H0: B-BRIDGE-1…7 traceability, cross-lot RED-first, `ports.ts:70–72`.

## AI Flaky tests
- [x] No AI tests or flaky acceptance requested for this documentation and fixture lot.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: one H0 author; no integration commits from other branches.
- [ ] **Multi-branch**: inapplicable to this bounded preparation lot.

## UAT Management (in orchestration context)
- [x] No UI/runtime behavior changes; web, Chrome and VSCode UAT are inapplicable to H0.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER, workflow, testing, harness and approved H0; verify input plan hash.
  - [x] Fetch main, create requested worktree, run `harness check branch` (PASS C1).
  - [x] Declare scope and prepare this file from `plan/BRANCH_TEMPLATE.md`.
- [ ] **Lot 1 — Mount and server inventory**
  - [ ] Record drift and all 24 mounts in 10 files, exactly one class and save authority per mount.
  - [ ] Inventory server descriptors, payloads, routes and settings/chat authorization without client lock gates.
- [ ] **Lot 2 — B1 real-content corpus**
  - [ ] Add API and UI JSON fixtures for prose, lists, matrix, three composers, plain fields and citations.
  - [ ] Identify source provenance, intended parity and profile differences requiring owner acceptance.
- [ ] **Lot 3 — Transfer register and gates**
  - [ ] Create N1–N8 receipts with source hashes, owners, consumers, exports, witnesses, disposition and deletion fields.
  - [ ] Add N8 correspondence; supersede older tree-binding and snapshot-only recovery wording.
  - [ ] Record installed-lock DS versions/digests, prerequisites and unqualified publication gates.
- [ ] **Lot 4 — Docs consolidation and validation**
  - [ ] Validate fixture JSON, byte hashes, corpus coverage, mount uniqueness/counts, receipt completeness and source references.
  - [ ] Check diff contains only documentation/fixtures; `make scope-check` before each commit.
  - [ ] Complete independent harness review; reconcile findings in the evidence note.
  - [ ] API/UI/E2E behavior tests: no test files changed; future adoption witness commands stay pending.
  - [ ] Create draft PR to main with this exact file as body and add the 3–6 step plan comment.
  - [ ] Verify CI completed/success at exact final head; report PR URL and head SHA.
  - [ ] Leave BRANCH.md and branch intact for the draft handoff; no merge.
