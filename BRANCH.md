# Feature: fix forge-tar unstable_tree on GitHub archives with symlinks

## Objective
Unblock the preprod P1 build (job 31bc4ffc) failing in `readForgeTarball` with a reason-less `LiveError('unstable_tree')` on a legitimate GitHub tarball, and give every `unstable()` a named reason so the host GET surface exposes `build_failed` with `code`/`reason`.

## Scope / Guardrails
- Scope limited to the forge tarball parser, its lease caller, and their unit tests.
- One migration max in `api/drizzle/*.sql` (none expected).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/fix-forge-tar` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test-fix-forge-tar`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=test-fix-forge-tar` must be passed as the last argument.
- All new text in English.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/forge-tar.ts`
  - `api/src/services/artifacts/live/forge-lease.ts`
  - `api/tests/unit/artifacts-live/forge-lease.test.ts`
  - `api/tests/unit/artifacts-live/forge-lease-source.test.ts`
  - `api/tests/unit/artifacts-live/forge-fixture.ts`
  - `api/tests/unit/artifacts-live/forge-tar-symlink.test.ts`
  - `BRANCH.md`
  - `.h2a/reviews/fix-forge-tar-argon.md`
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
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] `attention`: preprod P1 job 31bc4ffc (artifact bbe43e9c, rhanka/radar-immobilier@93116b8) failed in api job ledger as `failed`/`unstable_tree` with no reason; runtime DORMANT with stateDetail unstable_tree; host job still `building` (owner-urgent, blocks preprod variant P1).

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
- Rationale: single focused parser fix with scoped unit tests, one lane, one CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/fix-forge-tar`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/fix-forge-tar` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/fix-forge-tar` on branch `fix/forge-tar-unstable` from `origin/main` (verified).
  - [x] Define environment mapping: `ENV=test-fix-forge-tar`, `API_PORT=8905`, `UI_PORT=5305`, `MAILDEV_UI_PORT=1205`.
  - [x] Confirm command style: `make ... ENV=test-fix-forge-tar` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare no `BRxx-EXn` needed.
  - [x] Fetch real tarball to `/home/antoinefa/.cache-tmp/forge-tar-repro/93116b8.tar.gz` (untrusted data, headers only, never executed).
  - [x] Scan headers: 4236 entries (3883 regular, 2 symlinks type `2`, 350 dirs, 1 pax `g`); 0 bad checksums; 0 base-256.

- [x] **Lot 1 — Reproduce the unstable_tree branch**
  - [x] Feed the real tarball shape to the forge-tar parser in a unit test (synthetic fixture only, no 106 MB blob in repo).
  - [x] Identify which `unstable()` branch fires (`tar -tvzf`/`xxd` evidence: symlink type `2` at entry 1563, `deploy/k8s/40-immo-mcp-http-deploy.yaml`).
  - [x] Lot gate:
    - [x] `make typecheck-api API_PORT=8905 UI_PORT=5305 MAILDEV_UI_PORT=1205 ENV=test-fix-forge-tar`
    - [x] **API tests**
      - [x] New `api/tests/unit/artifacts-live/forge-tar-symlink.test.ts` (symlink + named-reason cases)
      - [x] Updated `api/tests/unit/artifacts-live/forge-lease.test.ts` (links are skipped, not refused)
      - [x] Scoped runs while evolving: `make test-api SCOPE=tests/unit/artifacts-live/forge-tar-symlink.test.ts API_PORT=8905 UI_PORT=5305 MAILDEV_UI_PORT=1205 ENV=test-fix-forge-tar`
      - [x] Sub-lot gate: forge scope green (forge-tar-symlink 4, forge-lease 8, forge-lease-source 5, host-build-api 12)
    - [x] **UI tests (TypeScript only)**
      - [x] None (no UI change).
    - [x] **E2E tests**
      - [x] None (parser unit scope; full suites run in CI).

- [x] **Lot 2 — Generic fix with named reasons**
  - [x] Skip link entries (types `1`/`2`) in `readForgeTarball` instead of failing the whole tree.
  - [x] Give every `unstable()` in `forge-tar.ts` a named reason; name the `source()` mismatch in `forge-lease.ts`.
  - [x] No silent limit widening (`FORGE_LIMITS`, `META_BYTES` unchanged); no legacy fallback.
  - [x] Lot gate: copy exact checklist of Lot 1.

- [x] **Lot 3 — Host failure visibility**
  - [x] Verify builder records `fail()` with `code`/`reason` and GET `/v1/builds/:artifactId/:jobId` exposes `build_failed` with `code`/`reason` (#969 mapping).
  - [x] State in the report whether immo must poll `status()` and where.
  - [x] Lot gate: copy exact checklist of Lot 1.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API (cf Lot 1, copy checklist)
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Record Gemini Argon high review to `.h2a/reviews/fix-forge-tar-argon.md`.
  - [ ] Write French report to `/home/antoinefa/src/sentropic/.tmp/rv/fix-forge-tar.md` (root cause with exact header, PR, head, CI, review).
  - [ ] Do NOT merge.
