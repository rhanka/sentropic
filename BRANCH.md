# Feature: oauth-register-client Job workingDir fix

## Objective
Fix `deploy/k8s/base/36-oauth-register-client-job.yaml` so the one-off Job finds `dist/scripts/oauth-register-client.js` in the production api image (`workingDir: /workspace/api`).

## Scope / Guardrails
- Scope limited to the one-line `workingDir` fix in the versioned Job yaml plus its verification.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/oauth-register-job`.
- No automated test campaign with running services in this lane (yaml-only change, no app code touched); PR CI is the validation gate. Never `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/base/36-oauth-register-client-job.yaml`
  - `.tmp/rv/fix-oauth-register-job.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `deploy/k8s/**` (this branch: single file above, via BROJ-EX1)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `acknowledge`: BROJ-EX1 — `deploy/k8s/base/36-oauth-register-client-job.yaml` touched (conditional path). Reason: the versioned Job sets `workingDir: /workspace` but the production api image carries the compiled script only at `/workspace/api/dist/scripts/oauth-register-client.js` (`api/Dockerfile:490`, final `WORKDIR /workspace/api`), so the pod fails with `MODULE_NOT_FOUND` before any DB write. Impact: one-line `workingDir` change (`/workspace` to `/workspace/api`); `command` unchanged; the sole caller `make oauth-register-client-job` applies the same base file, and no overlay patches this Job, so all tiers converge. Rollback: revert the line; the Job fails closed (no partial DB write possible).
- `acknowledge`: MERGE FREEZE (conductor 2026-11-05): no merge to main until PR #879 lands; this PR merges right AFTER #879. Do NOT merge; hand back after CI is green.
- `acknowledge`: No guard test added: the repo has no k8s-manifest validation pattern (only npm `validate-publishable-manifests`; no test reads `deploy/k8s` yaml, no `*.test.*` under `deploy/`); wiring a new test file would need a `Makefile` change (forbidden path).

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
- Rationale: single orthogonal one-line fix, one final test cycle on the PR CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch; no UAT required. Prod re-run of the packet is owned by the prod operation lane after this fix lands.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/rv/prod-oauth-immo-mcp.md`.
  - [x] Create isolated worktree `tmp/worktrees/oauth-register-job` on branch `fix/oauth-register-job-workdir` from `origin/main` (`1115dd372`); harness branch check PASS C1.
  - [x] Confirm scope boundaries and declare BROJ-EX1 for `deploy/k8s/base/36-oauth-register-client-job.yaml`.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last; commits via `make commit` only, no `[skip ci]`.
- [x] **Lot 1 — workingDir fix + proof**
  - [x] Prove image layout from `api/Dockerfile` (`COPY --from=build /workspace/api/dist /workspace/api/dist`, final `WORKDIR /workspace/api`) and build output (`api/package.json` `build` emits `dist/scripts/oauth-register-client.js`).
  - [x] Confirm no overlay or other caller relies on the old path (base kustomization excludes the Job; sole caller `make oauth-register-client-job` applies the same base file).
  - [x] Apply one-line fix: `workingDir: /workspace` to `workingDir: /workspace/api`.
  - [x] Lot gate:
    - [x] `harness check scope` clean before commit; commit via `make commit` only.
- [ ] **Lot 2 — PR + CI to green**
  - [ ] Open READY PR from `fix/oauth-register-job-workdir` (no `[skip ci]`), noting merge-after-#879 order.
  - [ ] Watch PR CI to green (no `gh run rerun --failed`; fresh head on transient only).
- [ ] **Lot 3 — Report, no merge**
  - [ ] Write `.tmp/rv/fix-oauth-register-job.md`.
  - [ ] Do NOT merge; hand control back.
