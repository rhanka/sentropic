# Feature: Fix CI SCA flaky rebuild (no app-image rebuild in SCA scan)

## Objective
Stop the `security-sast-sca` CI job from rebuilding the API/UI image from scratch (which flakes on transient `npm install -g npm@latest` network errors); audit `package-lock.json` directly in a lightweight node container, and pin npm in the Dockerfiles for reproducible builds.

## Scope / Guardrails
- Scope limited to the SCA scan path and Dockerfile npm pinning.
- No app behavior change: API/UI/E2E runtime code untouched.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/ci-sca-no-rebuild`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/Dockerfile`
  - `ui/Dockerfile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (requires `FIX-SCA-EX1`)
  - `.github/workflows/**`
- **Exception process**:
  - Declare `FIX-SCA-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `FIX-SCA-EX1` (`acknowledge`): Modify `Makefile` target `test-%-security-sca` (api/ui branch only).
  - Reason: the current branch runs `docker compose run --rm api npm audit`, which rebuilds the app image from scratch (no cache, no artifact reuse). That redundant build re-runs `npm install -g npm@latest` and flakes on transient npm registry errors — the actual cause of the red `security-sast-sca` job on `main` (run 26549886328), while `build-api-image` (same command) passed on the same run.
  - Change: replace the `compose run` rebuild with `docker run --rm node:24-alpine3.23 npm audit --json` against the mounted source `package-lock.json`. No app image build; dev+prod dependency coverage preserved (lockfile is the full tree; the production artifact has dev deps pruned, e.g. `drizzle-kit`, so reusing it would lose coverage — lockfile audit avoids that).
  - Impact: SCA scan no longer builds the app image → deterministic + faster. Output file `.security/sca-<svc>.json` keeps the same `npm audit --json` schema → parser/compliance scripts unchanged. No `ci.yml` change required (job only calls `make`).
  - Rollback: revert the single Makefile hunk.

## AI Flaky tests
- N/A — no AI tests in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal fix (CI/Dockerfile), no independent sub-workstreams.

## UAT Management (in orchestration context)
- N/A — no UI/UX surface change; nothing to UAT in a browser.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/security.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/ci-sca-no-rebuild` and develop there.
  - [x] Capture root cause: `security-sast-sca` rebuilds app image; flaky `npm install -g npm@latest`.
  - [x] Reproduce locally: `make build-api-image` → exit 0, both `npm audit --audit-level=high` gates pass (no blocking CVE).
  - [x] Confirm scope and guardrails; declare `FIX-SCA-EX1` for `Makefile`.
  - [x] Ports: not required (security scans use no published ports; no dev/e2e stack run).

- [ ] **Lot 1 — Pin npm in Dockerfiles**
  - [ ] `api/Dockerfile`: `npm install -g npm@latest` → `npm install -g npm@11.16.0`.
  - [ ] `ui/Dockerfile`: same pin.
  - [ ] Lot gate:
    - [ ] `make build-api-image` → succeeds, both npm audit gates pass.
    - [ ] `make build-ui-image` → succeeds.

- [x] **Lot 2 — SCA scan: audit lockfile, no app rebuild (`FIX-SCA-EX1`)**
  - [x] `Makefile` `test-%-security-sca` (api/ui branch): replace `docker compose run --rm api npm audit` (rebuilds app image) with `docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-alpine3.23 npm audit --json` against the root lockfile.
  - [x] Verify output schema unchanged (parser + compliance still pass): `npm audit --json` from lockfile (no node_modules) yields full report — 10 pkgs, `high: 0, critical: 0`, covering api+ui dev+prod deps (drizzle-kit, esbuild, @sveltejs/kit, svelte-i18n).
  - [x] Lot gate:
    - [x] `make test-api-security-sca ENV=test-fix-ci-sca` → passes, no app image build.
    - [x] `make test-ui-security-sca ENV=test-fix-ci-sca` → passes.

- [ ] **Lot N — Final validation**
  - [ ] `make build-api-image` + `make build-ui-image` (pinned npm).
  - [ ] `make test-security-sca` (aggregate api+ui) green.
  - [ ] No `packages/<pkg>/src/**` touched → no version bump required (`enforce-package-bump` N/A).
  - [ ] Create/update PR using this `BRANCH.md` as body.
  - [ ] Branch CI green on the PR (in particular `security-sast-sca`).
  - [ ] On CI green: commit removal of `BRANCH.md`, push, merge.
