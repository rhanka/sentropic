# Feature: Wagon perf/ci10-deps-key (toolbox dependency key survives release trains)

## Objective
- [ ] Keep the ghcr.io/rhanka/sentropic-ci-toolbox-deps base hit across package releases: the tooldeps key depends only on what changes the installed dependency content (miss measured on main run 42421623485 after #944).

## Scope / Guardrails
- [x] Branch perf/ci10-deps-key from origin/main a5d8dee87; worktree tmp/worktrees/ci10-deps-key; ENV=test-ci10-depskey.
- [x] Wagon only: branch push, no PR, no version bump, no lock or fixture regeneration.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; no local image build.
- [x] Scoped local checks only; full suites run in the train CI.
- [x] Cold fallback (api-tool-build.mjs), interface verification (verify-api-tool-deps) and main-only registry writes untouched.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
  - `package-lock.json`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed with declared exception)**:
  - `Makefile` under BR91-EX1.
  - `api/Dockerfile`, `.github/workflows/ci.yml`: not touched.

## Feedback Loop
- [x] BR91-EX1: Makefile `API_TOOL_DEPS_VERSION` computed by `node scripts/ci/api-tool-deps-key.mjs` instead of the inline sha256sum pipeline, and `test-ci-api-tool-cache` runs the two deps-key test files. Impact: same `tooldeps-<sha256>` tag shape and consumers; one more host node call at Makefile parse time (about 0.13 s). Rollback: restore the former Makefile line and drop the two test files.
- [ ] Acceptance: train CI on main shows `pull-api-tool-deps-registry` hit after a release-only train (thin toolbox build).

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branch merged by the train integration lane.

## UAT Management (in orchestration context)
- [ ] Exact-head train CI deps-base hit retained by the integration lane.

## Plan / Todo (lot-based)
- [x] Lot 0: proof against npm 11.16.0 sources and replay of 299 main first-parent pairs in .tmp/rv/wagon-ci10-deps-key.md.
- [x] Lot 1: scripts/ci/api-tool-deps-key.mjs (exact deps-stage inputs, workspace version dropped behind an edge-validity signature, inert manifest fields dropped, fail-closed on unevaluated specs).
- [x] Lot 2: normalization tests (workspace bump stable; external version/integrity/resolved/edge and workspace add/remove move the key; real-repo release).
- [x] Lot 3: semver oracle and Dockerfile input coverage tests.
- [x] Lot 4: Makefile wiring (BR91-EX1); scoped checks green (api-tool-cache 25/25, ci-dag 10/10, unit-graph 7/7, expected-results 28/28, ci-static 3/3, performance-report 8/8, run-metrics 36/36).
- [ ] Lot N: train CI green on the exact head; BRANCH.md removed at merge.
