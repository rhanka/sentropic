# Feature: Tag-Collision Guard for publish-api-image Job

## Objective
Guard the publish-api-image CI job against release tag collisions and overwrites by inspecting registry manifests before push, failing on different digests, and skipping idempotently on matching digests.

## Scope / Guardrails
- Scope limited to CI publication guard in Makefile, scripts/publish-api-image.sh, scripts/test-api-tag-guard.sh, .github/workflows/ci.yml, docs/ci-images.md.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/ci-tag-guard`.
- Automated test campaigns must run on dedicated environments (`ENV=test-ci-tag-guard`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `scripts/publish-api-image.sh`
  - `scripts/test-api-tag-guard.sh`
  - `docs/ci-images.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- **BR62-EX1** (status: `accepted`): Conditional `Makefile` change to route `publish-api-image` to `scripts/publish-api-image.sh` and add `test-ci-api-tag-guard`. Reason: implement tag collision guard and Make-only test target. Impact: ensures publish-api-image checks registry manifest before pushing and allows local/CI test execution. Rollback: revert Makefile targets to previous revision.
- **BR62-EX2** (status: `accepted`): Conditional `.github/workflows/ci.yml` change to wire `test-ci-api-tag-guard` into `build-api-image` and update `changes` global filters. Reason: automate tag-guard regression testing in PR CI. Impact: CI fails if tag guard regresses. Rollback: revert ci.yml edits.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single focused CI debt task on dedicated worktree

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/ci-tag-guard`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/ci-tag-guard` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm isolated worktree `tmp/worktrees/ci-tag-guard` and branch `fix/ci-publish-api-image-tag-guard`.
  - [x] Check branch alignment with origin/main (`harness check branch`).
  - [x] Create `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` with explicit scope exceptions BR62-EX1 and BR62-EX2.
  - [x] Verify baseline version filters (`make check-ci-version-filters API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`).
  - [x] Verify baseline scope check (`make scope-check API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`).

- [x] **Lot 1 — Publish guard implementation**
  - [x] Create `scripts/publish-api-image.sh` enforcing registry manifest inspect before push.
  - [x] Handle `exists-different` with exit 1 and tag collision error.
  - [x] Handle `exists-same` with idempotent push skip and exit 0.
  - [x] Handle `absent` with push and exit 0.
  - [x] Explicitly document and preserve moving tags behavior (`main`, `latest`).
  - [x] Update `publish-api-image` target in `Makefile` to call `scripts/publish-api-image.sh`.

- [x] **Lot 2 — Automated test suite**
  - [x] Create `scripts/test-api-tag-guard.sh` with isolated mock docker CLI.
  - [x] Implement test cases: `exists-different`, `exists-same`, `absent`, registry fatal error, and moving tags.
  - [x] Add `test-ci-api-tag-guard` target to `Makefile`.
  - [x] Run and pass test suite locally via `make test-ci-api-tag-guard API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.

- [x] **Lot 3 — CI workflow wiring**
  - [x] Update `.github/workflows/ci.yml` `changes` filter `global` to include new scripts.
  - [x] Add `make test-ci-api-tag-guard ENV=test-ci-api` step in `build-api-image` job.
  - [x] Verify `make check-ci-version-filters API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Update `docs/ci-images.md` to document immutable release tag collision guard and moving tags policy.
  - [x] Document CI history reference for the original incident (commit `ec018720d`).

- [x] **Lot N — Final validation**
  - [x] Run `make scope-check API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.
  - [x] Run `make test-ci-api-tag-guard API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.
  - [x] Run `make check-ci-version-filters API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.
  - [x] Push branch `fix/ci-publish-api-image-tag-guard` to origin.
  - [x] Open a draft PR for review.
  - [x] Generate `.h2a/build/ci_tag_guard_report.md` (untracked).

- [x] **Lot 4 — Review remediation (Opus PR #668 findings)**
  - [x] Address MAJ-1, m1, m2, m3 in `scripts/publish-api-image.sh` (exact manifest-unknown signal on stderr, fail closed on empty REGISTRY, reject moving tags, Docker-First containerized digest extraction).
  - [x] Address m5, m6, and MAJ-1 test requirements in `scripts/test-api-tag-guard.sh` (use `.tmp/`, add tests for credential helper not found, network error, no config digest, empty registry, moving tag refusal).
  - [x] Address m4 in `docs/ci-images.md` (restore TOCTOU window, serialization, and architectural limits from `main`).
  - [x] Address m7 in `BRANCH.md` (restrict `.github/workflows/**` to `.github/workflows/ci.yml`).
  - [x] Validate locally with `make test-ci-api-tag-guard API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.
  - [x] Verify `make scope-check API_PORT=9510 UI_PORT=5710 MAILDEV_UI_PORT=1610 ENV=test-ci-tag-guard`.
  - [x] Generate fix report in `.h2a/build/ci_tag_guard_fix_report.md`.

- [ ] **Lot 5 — Review remediation r2 (Opus PR #668 findings)**
  - [x] Address m1 in `scripts/test-api-tag-guard.sh` (test stderr-only isolation and case-sensitive matching).
  - [x] Address m3 in `scripts/test-api-tag-guard.sh` (Docker-First containerized digest extraction in mock docker, cover manifest index with child digest).
  - [x] Address m2 RED test in `scripts/test-api-tag-guard.sh` (add failing regression test for canonical 6-hex whitelist and invalid formats).
  - [ ] Address m2 GREEN fix in `scripts/publish-api-image.sh` (enforce canonical 6-hex API_VERSION whitelist ^[0-9a-f]{6}$).
  - [ ] Update `docs/ci-images.md` (document 6-hex tag format whitelist, generalize concurrency reference).
  - [ ] Address m4 across review commits (maintain atomic commits, TDD RED->GREEN progression, document trace in BRANCH.md).
  - [ ] Validate locally with `make test-ci-api-tag-guard`, `make check-ci-version-filters`, and `make scope-check`.

