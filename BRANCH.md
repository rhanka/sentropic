# Feature: oauth-register-client Job command path fix

## Objective
Fix the versioned one-off Job so `node` resolves the compiled registration script in the production api image; unblock the PROD `immo-mcp` refresh-eligibility update (`refresh_token` + `offline_access`).

## Scope / Guardrails
- Scope limited to the Job yaml command path and the sanctioned prod registration run.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/oauth-register-job-cwd`.
- No test-env services needed (no code change; validation is the live Job run plus public discovery).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/36-oauth-register-client-job.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `<none>`

## Feedback Loop

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
- Rationale: single one-line manifest fix plus one sanctioned prod run; no sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes; no UAT. Prod verification is the public discovery document.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Isolated worktree `tmp/oauth-register-job-cwd` on `fix/oauth-register-job-cwd` from `origin/main`.
  - [x] Harness branch check PASS.
  - [x] Root cause: Job `workingDir: /workspace` + `command: node dist/scripts/oauth-register-client.js` resolves to `/workspace/dist/...`, but the production image ships the script at `/workspace/api/dist/scripts/oauth-register-client.js` (`api/Dockerfile` `COPY --from=build /workspace/api/dist`, final `WORKDIR /workspace/api`). Live prod evidence: `Cannot find module '/workspace/dist/scripts/oauth-register-client.js'`.
  - [x] Fix convention: mirror `35-auth-idp.yaml` (same image, `workingDir: /workspace`, repo-relative command `apps/auth-idp/dist/index.js`) → command becomes `api/dist/scripts/oauth-register-client.js`.
  - [x] No maintained test covers this yaml (checked CI/test layout); per proportionality the live Job run is the check. No new test added.
- [ ] **Lot 1 — Fix and prod registration**
  - [x] Edit the Job yaml command path.
  - [ ] `make scope-check` + `harness check scope` before commit; commit via `make commit`.
  - [ ] Push branch; open PR (merge waits for freeze lift and review).
  - [ ] Re-run `make oauth-register-client-job SECRET_FILE=<0600 env file> ENV=prod` from this worktree with preserved `immo-mcp` values + `refresh_token` / `offline_access`.
  - [ ] Verify prod row and public discovery `?client_id=immo-mcp` advertises both.
  - [ ] Delete SECRET_FILE and temp kubeconfigs; update `.tmp/rv/prod-oauth-immo-mcp.md`.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (not applicable: yaml-only change; CI runs on PR).
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Merge only after owner freeze lift + review (not by this lane until approved).
