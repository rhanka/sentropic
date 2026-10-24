# Feature: Security hotfix body-parser 2.4.0 and dated zod exception

## Objective
Fix red main audit-gate (2 un-allowlisted HIGH findings) with a minimal public hotfix.

## Scope / Guardrails
- Scope limited to body-parser 2.4.0 lockfile bump, one dated zod exception, L5 derived-pin recompute.
- Public repo only, no private storage. Ready-for-review PR, no merge by this session.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/sec-hotfix-0124`.
- Automated test campaigns on `ENV=test-sec-hotfix`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Zero Python in automation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `.security/vulnerability-register.yaml`
  - `.security/audit-allowlist.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `api/Dockerfile`
  - `ui/Dockerfile`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `owner-all-public` / `acknowledge`: binding owner decisions. Public repos only, goal zero open findings at all times. For zod: dated exception plus migration.
- `conductor-merge-733` / `acknowledge`: merged `origin/fix/ci-mistral-small` (merge commit, no rebase) into this branch; kept this BRANCH.md on conflict. #733 is superseded by this PR.
- `zod-rooted-only` / `acknowledge`: extended the same dated exception (2026-11-07, Track 01M5PMR6AG9QDZG9H3N57TB3FS) to exact finding IDs, all verified zod-rooted in the lock/tree: `npm_audit_api_zod_high`, `npm_audit_api_@ai-sdk_provider-utils_high` (HIGH via zod peer dep; own GHSA-866g is low), `npm_audit_api_ollama-ai-provider_high` (no own advisory), `npm_audit_ui_zod_high`, `CVE-2023-54404_api_zod_3.23.8`, `CVE-2023-54404_api_zod_3.25.76` (CVE confirmed as zod record). No non-zod finding covered. The comments-tree `GHSA-mrhx-c7xc-m3w5` (published `@sentropic/comments@0.3.0` pins zod ^3.25.76, no fixed release exists) has no exception mechanism in its plain-`npm audit` step: residual red, unblocks only via the zod v4 migration release.
- `root-cause` / `attention`: main audit-gate red since 2026-10-24 ~07:58Z (run 40076120099). body-parser 2.3.0 in range [2.0.0, 2.4.0) fixed by 2.4.0 patch. zod 3.25.76 (< 4.6.6) has no same-major fix, only major v4, so dated exception plus migration.

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
- Rationale: single minimal hotfix, one PR.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT required.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/sec-hotfix-0124`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/sec-hotfix-0124` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md` and `rules/workflow.md`.
  - [x] Create isolated worktree `tmp/worktrees/sec-hotfix-0124` from `origin/main` on branch `fix/security-bodyparser-zod-0124`.
  - [x] Reproduce audit-gate offenders via `make test-api-security-sca ENV=test-sec-hotfix` and capture GHSA ids.
  - [x] Define environment mapping (`ENV=test-sec-hotfix`) for this branch.
  - [x] Confirm command style: `make ... ENV=test-sec-hotfix` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare exceptions if needed.
- [x] **Lot 1 — body-parser 2.4.0 lockfile bump**
  - [x] Fetch body-parser 2.4.0 registry metadata and verify integrity hash.
  - [x] Bump `node_modules/body-parser` entry in `package-lock.json`, `api/package-lock.json`, fixture lock.
  - [x] Prove no manifest range change needed (express `^2.2.1` admits 2.4.0).
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-hotfix`
    - [x] `make commit MSG="..." ENV=test-sec-hotfix` with selective `git add`
- [x] **Lot 2 — Dated zod exception plus L5 recompute**
  - [x] Add ONE `accepted_temporary` zod entry to `.security/vulnerability-register.yaml` (review_due 2026-11-07, Track ref, owner quote).
  - [x] Add matching zod GHSA entry to `.security/audit-allowlist.json` (review_due 2026-11-07).
  - [x] Prove no L5 P1 re-pin needed: `make memory-l5-verify` passes unchanged (fingerprint outside P1 closure).
  - [x] Leave P1 provenance to the post-merge regen flow (precedent 84667d57a), not this PR.
  - [x] Lot gate:
    - [x] `make scope-check ENV=test-sec-hotfix`
    - [x] `make memory-l5-verify ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json ENV=test-sec-hotfix`
    - [x] `make commit MSG="..." ENV=test-sec-hotfix` with selective `git add`
- [ ] **Lot N — Final validation**
  - [x] Run audit gate locally via image builds (`make build-api-image-fresh`, `make build-ui-image`): both green, `npm ci` consistent.
  - [x] SCA api/ui compliance green; container api compliance green (only the 2 zod findings, both accepted).
  - [ ] Final gate step 1: PR body is `BRANCH.md` text (PR already open, update body on push).
  - [ ] Final gate step 2: run and verify branch CI green on the exact head.
  - [ ] Final gate step 3: do NOT merge, report PR number, head SHA, CI URL.
