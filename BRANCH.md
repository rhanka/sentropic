# Feature: builder-memory-limit-1536

## Objective
Set the builder worker pod memory limit (and request) back to 1536Mi on 2 x d2-4 nodes.

## Scope / Guardrails
- Scope limited to builder pod memory resources, quota comments, sizing-guard tests.
- Make-only workflow, Docker via docker-slot.sh in the foreground.
- ENV=test-mem-1536 last in every make command.
- Branch work in tmp/worktrees/builder-mem-1536, never on root.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/pods.ts`
  - `api/src/services/artifacts/live/product-builder.ts`
  - `api/tests/unit/artifacts-live/pods.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop

## AI Flaky tests
- [ ] Non-systematic provider/model nondeterminism only, same commit plus one success, command plus file plus signature recorded here.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single small memory-value change, one test file.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: UAT on the integrated branch (no user-facing change, no UAT surface).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, .tmp/packets/COMMON-RULES.md.
  - [x] Create isolated worktree tmp/worktrees/builder-mem-1536 on fix/builder-memory-limit-1536 from origin/main.
  - [x] Verify branch: fix/builder-memory-limit-1536 at origin/main 599582db9.
  - [x] Environment mapping: ENV=test-mem-1536, API_PORT=8967, UI_PORT=5367, MAILDEV_UI_PORT=1267.
  - [x] Confirm command style: docker-slot.sh make ... ENV=test-mem-1536 with ENV last.
  - [x] Confirm scope: request=limit 1536Mi, CPU limit 4, MAX_BUILDER_PODS 4, ephemeral 3400Mi unchanged.
- [x] **Lot 1 — Memory limit 1536Mi**
  - [x] pods.ts: requests.memory and limits.memory 1280Mi/2048Mi to 1536Mi/1536Mi, quota comments 6Gi/6Gi.
  - [x] product-builder.ts: composition contract comment 6Gi/6Gi.
  - [x] pods.test.ts: manifest expectations and sizing-guard assertions to 1536Mi and 6Gi quotas.
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=test-mem-1536` PASS.
    - [x] `make lint-api ENV=test-mem-1536` PASS (warnings no-console preexistants uniquement).
    - [x] `make scope-check` PASS C2.
    - [x] Scoped API test: pods.test.ts 17/17 PASS en one-shot compose run (fixture 100 % memoire, meme image; gate exec canonique bloque sur saturation inotify hote EMFILE, couvert par la CI).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck plus lint for api.
  - [ ] PR from BRANCH.md text, CI green, no merge.
  - [ ] Delete BRANCH.md, push, report in French to .tmp/rv/builder-mem-1536.md.
  - [ ] make down-volumes ENV=test-mem-1536.
