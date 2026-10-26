# fix(artifacts): 0.2.2 listKeys prefix parity (memory = S3)

## Objective
- [x] Make memory and S3 listKeys reject the same invalid prefixes through one validator.
- [ ] Release a compatible patch at 0.2.2; push a PR with green CI, then merge on owner GO.

## Scope / Guardrails
- [x] Base: origin/main; branch: fix/artifacts-0.2.2-listkeys-parity.
- [x] Worktree: tmp/worktrees/artifacts-022; make-only; no Python.
- [x] ENV=test-artifacts-022 always last; shared Docker flock for every build/test/cleanup.
- [x] Compose qualification has no host ports; no API/UI/Maildev services are started.
- [x] Keep packages/artifacts/l0-freeze byte-identical; no breaking API changes.
- [x] Selective staging; make commit only; each commit below 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/blob-prefix.ts`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/adapters/s3.ts`
  - `packages/artifacts/tests/s3.integration.test.ts`
  - `packages/artifacts/tests/publication-security.test.ts`
  - `packages/artifacts/package.json`
  - `packages/artifacts/src/mcp-core.ts` (ARTIFACTS_PROVIDER_VERSION constant only, aligned on 0.2.2)
  - `package-lock.json` (artifacts workspace version only)
- **Forbidden Paths (must not change in this branch)**:
  - `packages/artifacts/l0-freeze/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR022-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback before editing conditional paths.

## Feedback Loop
- [x] BR022-EX1: acknowledge; owner: code author; 2026-10-26. Add test-artifacts-022 to existing Compose ENV selectors only. Required by the requested ENV and Docker lock; no recipe changes. Rollback: remove that ENV from the selectors.
- [x] Review availability: no live model catalog configured for selecting two complementary reviewers; selection-failed recorded in tmp/artifacts-022-review/dossier.md. No consensus claimed; merge remains prohibited.

## AI Flaky tests
- [x] No AI/provider tests in this package fix; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one code author; independent review through harness when available.

## UAT Management (in orchestration context)
- [x] Package-only change; web, Chrome and VSCode UAT not applicable.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, project rules, template and relevant harness skills.
  - [x] Create worktree from origin/main; mechanical harness branch check passed.
  - [x] Identify existing Compose test, lint, typecheck, freeze and cleanup targets.
  - [x] Enable requested ENV in existing disposable Compose lane.
- [x] **Lot 1 — Regression first**
  - [x] Add a shared memory/S3 case matrix in tests/s3.integration.test.ts.
  - [x] Exercise empty, embedded '..', valid matching and unmatched prefixes on real MinIO.
  - [x] Before production changes: 12 expected failures (6 memory acceptances, 6 untyped S3 errors), 15 passing tests. Command: make -o build-artifacts test-artifacts-integration SCOPE=tests/s3.integration.test.ts ENV=test-artifacts-022.
- [x] **Lot 2 — Shared validation and patch version**
  - [x] Add one shared prefix validator; both stores call it before enumeration/I/O.
  - [x] Reuse typed invalid_request errors, preserve message, add stable invalid_blob_prefix code.
  - [x] Registry latest is 0.2.1; bump package.json and workspace lock entry to 0.2.2.
  - [x] Update four existing publication-security empty-store assertions to enumerate artifacts/.
  - [x] Parity: 27/27; full integration/E2E suite passed; unit suite: 446/446. Typecheck, lint and freeze-types passed under the shared Docker lock on ENV=test-artifacts-022.
- [ ] **Lot 3 — Review and delivery**
  - [x] Author review of every diff hunk completed; no remaining blocking code findings.
  - [x] Confirm l0-freeze unchanged and scope-check before each commit.
  - [ ] Push and open PR to main using this file as PR body.
  - [ ] Verify enforce-package-bump and all CI checks on exact head SHA.
  - [ ] Tear down isolated stack; report PR number, head SHA and CI URL.
  - [x] Owner GO « Go 0.2.2 » received 2026-10-26: merge authorized via gh pr merge --merge --match-head-commit, then remove BRANCH.md for merge preparation.
- [x] BR022-EX2: merge origin/main 2026-10-26; resolved BRANCH.md (kept branch file) and Makefile (union of ENV selectors, kept main recipes); package-lock auto-merged with artifacts 0.2.2 intact. Rollback: git reset --hard 01499d513.
- [x] BR022-EX3: merge origin/main 22d8a9e68 (post-#760) 2026-10-26; BRANCH.md conflict resolved by keeping branch file; rest auto-merged. Rollback: git reset --hard 90c1d414a.
- [x] BR022-EX4: merge origin/main ab981b16d (post-#756) 2026-10-26; BRANCH.md kept, Makefile union intact, rest auto-merged. Rollback: git reset --hard e07add6a0.
