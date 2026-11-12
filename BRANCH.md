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
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/llm-gateway/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/services/llm-account-transports.ts`

## Feedback Loop
- [x] BREM-EX3: owner-approved RUN 3 minimal release/runtime extension. Rationale: published gateway dependency-map guard and cluster runtime ceiling block CI. Impact: gateway 0.23.1, cluster 0.26.0-dev.25, matching root lock workspace versions, text/speech ceilings <0.38.0, and the four range regression tests listed above. Rollback: revert the RUN 3 extension commits; no gate or workflow change.
- [ ] RUN 3: verify focused cluster range tests, strict lock, candidate guard and full CI on the exact head.
- [x] BREM-EX2: owner-approved consumer range exception (RUN 2). Rationale: the llm-mesh minor version bump requires compatible consumer ranges. Impact: only the cluster-mesh peer field, llm-gateway dependency field and root lock. Rollback: revert this commit.
- [x] RUN 2: rebase onto origin/main required no replay; published llm-mesh remains 0.36.0, below this branch version. Candidate lock changes exactly two consumer range cells; strict npm ci --ignore-scripts --dry-run passed without force or legacy-peer-deps.
- [x] Local Muse provider catalog confirms muse-ember-1.0; transport model IDs are not enumerated.
- [x] Track import reserved for designated conductor; source artifact is this plan.
- [x] BREM-EX1: synchronize only the root lock's llm-mesh workspace version; CI changes rejects the mandatory package bump without it. No dependency graph change; rollback is restoring that version cell.
- [x] Muse review found API model count 37 must become 38; corrected alongside its expected ID list.

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
