# Feature: artifacts upload checksum fail-closed (OVH 403 + commit integrity)

## Objective
Fix the presigned upload checksum mismatch and close the commit integrity hole in @sentropic/artifacts, shipping as patch 0.2.16.

## Scope / Guardrails
- Scope limited to @sentropic/artifacts upload channel (adapters/s3-uploads, server/uploads, upload-page, templates), the 0.2.16 version bump with CHANGELOG, and lock/pin refresh through make.
- One migration max in `api/drizzle/*.sql` (none expected; no migration planned).
- Make-only workflow, no direct Docker commands; every Docker-using make command goes through `.tmp/packets/docker-slot.sh`, one slot per command, never nested.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-upload-checksum`.
- Automated test campaigns run on dedicated environment (`ENV=test-upload-cksum`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/adapters/s3-uploads.ts`
  - `packages/artifacts/src/server/uploads.ts`
  - `packages/artifacts/src/server/upload-page.ts`
  - `packages/artifacts/src/server/templates.ts`
  - `packages/artifacts/src/mcp-core.ts` (provider version constant only)
  - `packages/artifacts/src/http.ts` (create_upload response shape only)
  - `packages/artifacts/tests/**`
  - `packages/artifacts/CHANGELOG.md`
  - `packages/artifacts/package.json`
  - `packages/artifacts/README.md` (upload channel docs only)
  - `package-lock.json` (workspace version entry only)
  - `api/package-lock.json` (workspace version entry only)
  - `api/src/services/mcp/cluster-registry.ts` (APP-P1 digest re-pin only)
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (integrity pin only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `tools/memory-mcp-l5/**` (L5 P1 manifest regen only if a CI gate demands it)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- No exceptions declared.

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
- Rationale: Single orthogonal fix in one package plus its version pins; one final test cycle and one CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT lot. Preprod verification by immo happens after merge (out of scope; this lane does not merge).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md` constraints (done: make-only, docker-slot.sh, no skip ci, never ENV=dev, no clean-all, make commit without AI trailer).
  - [ ] Confirm worktree `tmp/worktrees/artifacts-upload-checksum` on branch `fix/artifacts-upload-checksum` tracking `origin/main`.
  - [ ] Copy `.env` into the worktree for compose runs (gitignored, never committed).
  - [ ] Confirm environment mapping: `ENV=test-upload-cksum` always last; `API_PORT=8797`, `UI_PORT=5197`, `MAILDEV_UI_PORT=1097`.
  - [ ] Confirm scope boundaries and no `BRxx-EXn` needed unless a CI gate demands `tools/memory-mcp-l5/**`.
- [x] **Lot 1 — Failing tests first (no implementation edits)**
  - [x] Add `packages/artifacts/tests/uploads-commit-integrity.test.ts` with three tests: corrupted upload refused at commit (typed error, staging object deleted, no release, session not committable); correct upload with exactly the announced headers commits; announced header set equals the signed header set (no `x-amz-*` beyond the signature, no `checksumHeader` field).
  - [x] Run the new file scoped: `SCOPE=tests/uploads-commit-integrity.test.ts` via `test-artifacts`; observe failures as the repro baseline (4/4 red with the expected failure modes: untyped refusal, announced `checksumHeader`).
  - [x] Sub-lot gate: `make typecheck-artifacts` + `make lint-artifacts` with `ENV=test-upload-cksum` last (0 errors; 3 pre-existing warnings in `files-parity-lot2.test.ts`, untouched).
- [ ] **Lot 2 — Fail-closed fix**
  - [x] `packages/artifacts/src/server/uploads.ts`: stop announcing `checksumHeader`; `requiredHeaders` is exactly the signer output; typed verification error; delete/quarantine the staging object on size/digest mismatch; no release on mismatch (3 commits: typed errors, quarantine, header removal).
  - [x] `packages/artifacts/src/adapters/s3-uploads.ts`: sign content-type plus exact content-length only; remove the unsigned checksum announcement path.
  - [x] `packages/artifacts/src/server/upload-page.ts`: PUT carries exactly the announced headers.
  - [x] `packages/artifacts/src/server/templates.ts`: guide text matches the fixed channel (no checksum header).
  - [x] Update existing tests that assert the old announced header (`uploads.test.ts`, `files-parity-lot1.test.ts`, `files-parity-lot2.test.ts`) to the new contract without weakening refusal coverage (refusals kept; retry tail strengthened to refusal).
  - [x] Lot gate: new tests green (4/4); `make typecheck-artifacts` + `make lint-artifacts` (0 errors); scoped `make test-artifacts` green for `uploads.test.ts` (6/6), `files-parity-lot1.test.ts` (7/7), `files-parity-lot2.test.ts` (20/20), `http-uploads-templates.test.ts` (15/15), `http-mcp-service-parity.test.ts` (9/9) with `ENV=test-upload-cksum` last.
- [x] **Lot 3 — Patch release 0.2.16**
  - [x] Bump `packages/artifacts/package.json` to `0.2.16` (stays in `0.2.x` per the cluster-mesh `>=0.2.0 <0.3.0` allocation).
  - [x] Bump `ARTIFACTS_PROVIDER_VERSION` in `packages/artifacts/src/mcp-core.ts`.
  - [x] Add `CHANGELOG.md` entry for `0.2.16` with the fix and the header-contract choice plus OVH/minio justification.
  - [x] Refresh locks/pins: root and `api` lock workspace entries, `APP-P1` manifest digest re-pin in `api/src/services/mcp/cluster-registry.ts` (digest computed in the api container via `make exec-api`, corroborated by the registry tests), api registry tests updated.
  - [x] Cluster-mesh selected fixture left at `0.2.15`: its integrity pin comes from the verified release archive (sanctioned `refresh-lazy-package-lock` flow, post-publish), and the packaging harness installs the selected fixture from the registry, which has no `0.2.16` yet. Precedent: `f11eca02e` shipped the release without the fixture; `b6631c4b5`/`530ed7aff` re-pinned after publication.
  - [x] Verify `npm view @sentropic/artifacts version` is below `0.2.16` (Post-Rebase Gate after any rebase): registry reports `0.2.15`.
  - [x] Lot gate: `make scope-check` before every commit; commits under 150 lines via `make commit`.
- [ ] **Lot 4 — Final validation**
  - [ ] Typecheck & Lint for impacted components.
  - [ ] Scoped `make test-artifacts` full unit run with `ENV=test-upload-cksum` last.
  - [ ] Scoped api registry tests for the re-pin with `ENV=test-upload-cksum` last.
  - [ ] `make down-volumes ENV=test-upload-cksum` at the end (disk hygiene).
  - [ ] Bumped `packages/artifacts/package.json` version verified (CI `enforce-package-bump` gate).
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as PR body, state READY.
  - [ ] Final gate step 2: run/verify one branch CI on that head and resolve remaining blockers (no re-runs except proven transient; never `gh run rerun --failed`).
  - [ ] No merge (packet: report only); no `BRANCH.md` deletion commit.
