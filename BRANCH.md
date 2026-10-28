# Feature: Engram E11 tuple and receiving handoff preparation

## Objective
- [ ] Prepare deterministic `e2-host-tuple/v1` tooling and receiving checklist; gr-conductor owns final generation after stable E9/E10 evidence.

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-engram-e11` from integration `52936121af9a67e3605f5c09c0e70c021b8da1d9`; worktree `tmp/worktrees/mem-e11`; merge only, never rebase.
- [x] Preparation only: no publication, version bump, artifacts source edits or receiving ACK.
- [x] Read-only candidates: Engram 0.22.0 `26a0edd5…`; mesh 0.24.0-dev.5 `11a8fe85…`; pending Engram 0.21.3 intentHash and successor mesh pack.
- [x] Node 24 through make and Docker flock; no Python; ENV=test-mem-e11 last; make down after each Docker step.
- [x] No services or host ports required; API 9055, UI 5255, Maildev 1155 reserved if needed; owner environments untouched.
- [x] Atomic make commits at most 150 changed lines; selective staging; no AI trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/engram-e11/**`
  - `Makefile` (BR11-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `package-lock.json`
  - `tools/memory-mcp-l5/artifacts/**`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.track/**`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None beyond BR11-EX1.
- **Exception process**:
  - [x] BR11-EX1: add only test-mem-e11 to host scope-check selector, avoiding an unrelated harness build; impact validation routing; rollback remove selector.

## Plan / Todo (lot-based)
- [x] **Lot E11-0 — Baseline and scope**
  - [x] Read MASTER/workflow, plan E11, PR #803 E11 inputs, Opus r3 21-entry inventory, RESERVATION.md and Docker lock packet; mechanical branch PASS.
- [ ] **Lot E11-1 — Generator and checker**
  - [ ] Add `tools/engram-e11/{tuple,bindings,slots}.mjs` and candidate spec; hash files/tarballs/backend/C6/locks; reject drift and status promotion.
  - [ ] Add `tools/engram-e11/e11.mk`: pinned Node 24, temporary evidence, deterministic dry-run/check; no lock regeneration.
  - [ ] Add `tools/engram-e11/tuple.test.mjs`: tampering, missing input, pending/final refusal, deterministic output.
- [ ] **Lot E11-2 — Receiving handoff**
  - [ ] Add `tools/engram-e11/README.md`: 21 categories, PENDING reasons, retained-lock install, reservation, main PR, CI publication, byte recheck, separate C9/L5 ACKs.
- [ ] **Lot E11-3 — Evidence and draft PR**
  - [ ] Run make tests and candidate dry-run/check under flock; retain tuple SHA-256/PENDING inventory; make down.
  - [ ] Review scoped diff; draft PR against feat/engram-e2-integration; completed/success CI on exact head; no merge/publication.

## AI Flaky tests
- [x] No provider tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Evidence tooling only; web, Chrome and VSCode unaffected; deterministic checks and negative tests.

## Feedback Loop
- [ ] PENDING: #803 rerun and Engram 0.21.3 / rhanka/engram#410 must stabilize; mesh must carry NeutralAtomicUnit.intentHash in a new pack-only dev candidate.
- [ ] PENDING: five profiles declared/equivalence not-covered; C6 final 1.0.0 bytes, producer C9 and Sentropic/L5 ACKs remain open.
- [x] Review author: host codex, model gpt-6.1-sol, effort high (owner declaration).
