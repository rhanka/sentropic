# Feature: CI registry egress containment

## Objective
- [ ] Confirm October Scaleway traffic from workflow history, GitHub run metadata and compressed registry layers; protect build-once artifact transport and BR-82 tested-image identity.
- [ ] Report API layer growth and propose a separate slimming lot without implementing it.

## Scope / Guardrails
- [x] Wagon `perf/ci-registry-egress`, base `origin/main` at `c107f6abd70e47e0aba33ab4afad01f8dafe4534`; worktree `tmp/worktrees/ci-registry-egress`; no PR, release, version bump or lock regeneration.
- [x] Make-only; Docker commands use `.tmp/packets/docker-slot.sh`; no Python; secrets never printed.
- [x] Tests: `ENV=test-ci-registry-egress`, API_PORT=9666, UI_PORT=5866, MAILDEV_UI_PORT=1766; metadata/unit containers expose no ports or service stacks.
- [x] Host scope-only gate uses `make scope-check ENV=test-llm-judge` with installed harness on PATH; no services use that environment.
- [x] No CI skipping, reruns, weakened tests, runtime changes, registry deletion or deployment.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.github/workflows/ci.yml` (CIFINOPS-EX1)
  - `scripts/ci/ci-dag.test.mjs`
  - `docs/ci/registry-egress.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `packages/**`
  - `.track/**`
  - `package*.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback before editing a conditional path.

## Feedback Loop
- [x] CIFINOPS-EX1 — Owner authorizes CI-internal image transport changes. Remove unused Scaleway credentials only from image producers and browser consumers; add transport regression coverage. Preserve publisher/deploy credentials, all tests, artifacts, receipts and BR-82 identity checks. Rollback: restore those environment entries and remove transport assertions.
- [x] API fan-out moved to artifacts October 4 (`ec018720d`), E2E/UI October 28 (`c8ec01237`). Current baseline already builds each candidate once per run; reuse option (a).
- [ ] TRACK-HANDOFF — Integration's designated Track writer must import this mergeable source and the requested API-slimming follow-up; this concurrent wagon does not append `.track/events.jsonl`.
- [ ] TRAIN-GATE — Consolidated independent review and required CI belong to the dated integration train, per owner wagon rules.

## AI Flaky tests
- [x] No provider tests or flaky-test exception; no retries or timeout changes.

## Orchestration Mode (AI-selected)
- [x] Mono-branch wagon; no delegated implementation or cherry-pick.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] No product behavior change; web, Chrome and VSCode qualification stays in train CI.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read common/project/harness/testing rules; mechanically pass branch check.
  - [x] Count October runs with paginated GitHub API; inspect successful early/mid/late October job receipts.
  - [x] Fetch registry manifests/config history without downloading image layers; distinguish stored unique layers from one-image transfer size.
- [ ] **Lot 1 — Protect artifact-only CI transport**
  - [ ] Regress unused registry credentials, remote pull fallback and missing receipt transport in `scripts/ci/ci-dag.test.mjs`.
  - [ ] Remove unused producer/browser Scaleway credentials in `.github/workflows/ci.yml`.
  - [ ] Run `make test-ci-dag test-ci-image-receipts test-ci-release-receipts ENV=test-ci-registry-egress`; preserve every BR-82 check.
- [ ] **Lot 2 — Evidence and handoff**
  - [ ] Commit findings/slimming proposal in `docs/ci/registry-egress.md`; write owner report `.tmp/rv/ci-registry-egress.md`.
  - [ ] Report historical and current before/after GB per full run/month, with assumptions and marginal savings separated.
  - [ ] Pass scope before each bounded `make commit`; push verified wagon without PR or CI dispatch.
  - [ ] Run `make down-volumes ENV=test-ci-registry-egress`; hand off Track import, consolidated review and train CI.

## Deferred to train
- [ ] **API-SLIM — Runtime file allowlist and registry retention proposal**: owner=CI/API maintainers; preserve API/IdP/content runtime assets and tested-image identity; measure compressed layers and qualify canonical production image before rollout. Registry deletion requires a separate retention policy protecting deployment references.
