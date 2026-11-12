# Feature: Muse Ember model catalog

## Objective
- [ ] Expose Muse Ember with its canonical ID, vision, 1M context and xhigh/max efforts.

## Scope / Guardrails
- [x] Isolated worktree: tmp/worktrees/muse-ember; branch feat/llm-mesh-muse-ember.
- [x] Make-only, Docker-first; ENV=test-muse-ember last; no secrets or AI trailers.
- [x] Ports reserved only if needed: API 9700, UI 5900, Maildev 1800; no services required.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/services/llm-account-transports.ts`

## Feedback Loop
- [x] Local Muse provider catalog confirms muse-ember-1.0; transport model IDs are not enumerated.
- [x] Track import reserved for designated conductor; source artifact is this plan.

## AI Flaky tests
- [x] No live provider calls.

## Orchestration Mode
- [x] Mono-branch; independent Gemini capability uses a separate branch because combined scope exceeds 15 files.

## UAT Management (in orchestration context)
- [x] Catalog-only change; no browser UAT surface.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, verify branch and local canonical model ID.
- [x] Lot 1: update providers, catalog, reasoning metadata and package version (0.37.0 > published 0.36.0).
- [x] Lot 2: extend muse.test.ts, models.test.ts and llm-runtime-stream.test.ts.
- [ ] Lot 3: run scoped tests, typecheck, scope check and independent review.
  - [x] make test-llm-mesh SCOPE=tests/muse.test.ts ENV=test-muse-ember: 8 tests passed.
  - [x] make typecheck-llm-mesh ENV=test-muse-ember: passed.
  - [x] make scope-check ENV=test-llm-judge: PASS C2.
  - [ ] Argon review failed with account PERMISSION_DENIED; Muse review dispatched.
- [ ] Lot 4: open PR, verify CI on exact head and report evidence.
