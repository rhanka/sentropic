# Feature: email-code-hmac preflight `auth can-i` argv fix (run 41622762835)

## Objective
Fix the preflight rights check in `deploy/ci/email-code-hmac/workflow.mjs` so it calls
`kubectl auth can-i <verb> <resource>/<name>` (two positional arguments) instead of the
three-argument form `<verb> <resource> <name>`, which real kubectl rejects with
"you must specify two arguments: verb resource or verb resource/resourceName" and which
made preprod run 41622762835 fail at "Preflight shell and writer rights" with
`email_code_hmac_writer_forbidden`. Harden the selftest stub kubectl to reject the
malformed form and add a regression test.

## Scope / Guardrails
- Scope limited to `deploy/ci/email-code-hmac/**` (see BR900-EX1) and the reviewed workflow file `.github/workflows/email-code-hmac-secret.yml` (read-only check, no change expected).
- Make-only workflow, no direct Docker commands; one Docker lock per make command, never nested.
- Branch development happens in isolated worktree `tmp/worktrees/qk-preflight-fix`.
- Tests run on `ENV=test-email-code-hmac` only, never `ENV=dev`; lane ends with `make down-volumes ENV=test-email-code-hmac`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. No secret value is ever printed, logged or committed.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/email-code-hmac/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**` — see BR900-EX1
- **Exception process**:
  - BR900-EX1 declared below in `## Feedback Loop` before touching any conditional/forbidden path, with reason, impact and rollback.

## Feedback Loop
- [x] **BR900-EX1 — `deploy/ci/**` and `.github/workflows/email-code-hmac-secret.yml` (owner GO on Q-K)**: touch only the preflight `auth can-i` argv in `workflow.mjs`, the stub kubectl in `selftest-kit.mjs` and the regression test in `workflow.selftest.mjs`. Reason: preprod run 41622762835 of `.github/workflows/email-code-hmac-secret.yml` failed at "Preflight shell and writer rights" with `email_code_hmac_writer_forbidden` because `workflow.mjs` passed three positional arguments to `kubectl auth can-i`; real kubectl only accepts `<verb> <resource>` or `<verb> <resource>/<name>`. Authority: owner GO on Q-K (same authority as the BR900 lane that introduced these files). Impact: no behavior change other than the corrected argv form; the selftest stub now mirrors real kubectl argv validation, so the old form can never pass silently again. The workflow YAML itself is not modified. Rollback: revert the single commit; preflight reverts to the failing three-argument form.

## AI Flaky tests
- Deterministic offline selftests only (`--network none`, stub binaries); no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single small fix; one test cycle)
- Rationale: one bug, three files, one selftest target; no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Worktree `tmp/worktrees/qk-preflight-fix` created from `origin/main`; `harness check branch` PASS.
  - [x] Target captured: `make test-email-code-hmac-selftest ENV=test-email-code-hmac`.
  - [x] ENV mapping: `test-email-code-hmac` only.
  - [x] Command style: `make ... ENV=<env>` with ENV last, one flock per make command on `.tmp/packets/DOCKER-LOCK.md`.
  - [x] Scope boundaries declared; BR900-EX1 recorded.
- [x] **Lot 1 — Fix + regression test**
  - [x] `deploy/ci/email-code-hmac/workflow.mjs`: preflight calls `auth can-i <verb> <resource>/<name>`.
  - [x] `deploy/ci/email-code-hmac/selftest-kit.mjs`: stub kubectl rejects any `auth can-i` without exactly verb + `resource/name` (real kubectl error, exit 1).
  - [x] `deploy/ci/email-code-hmac/workflow.selftest.mjs`: regression test — stub rejects the legacy 3-argument form, accepts `resource/name`, and every recorded preflight `can-i` call uses the two-argument form.
  - [x] Lot gate: `flock .tmp/packets/DOCKER-LOCK.md make test-email-code-hmac-selftest ENV=test-email-code-hmac` green, then `flock .tmp/packets/DOCKER-LOCK.md make down-volumes ENV=test-email-code-hmac`.
- [x] **Lot 2 — Final validation**
  - [x] `make scope-check` before commit.
  - [x] `make commit MSG="fix: ..."` (specific files staged only), push `fix/email-code-hmac-preflight-can-i`.
  - [x] READY PR opened from this BRANCH.md text; exactly one pull_request CI run on the final head.
  - [x] Report written to `.tmp/rv/qk-preflight-fix.md`.
