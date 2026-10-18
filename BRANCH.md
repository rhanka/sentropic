# Feature: Bootstrap token publishes bypass npm provenance

## Objective
Make every `publish-*-token` bootstrap recipe publish successfully from the CI bootstrap job by passing `--provenance=false` explicitly on the token path. OIDC publishes keep provenance.

## Scope / Guardrails
- Scope limited to `Makefile` token recipes, `scripts/ci/**` guard tests, `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/bootstrap-publish-provenance`.
- Automated test campaigns run on dedicated environments, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Never merge, never publish, never trigger the bootstrap workflow, no secrets.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `Makefile`
  - `scripts/ci/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `rules/**`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
  - `.github/workflows/**`
  - everything else
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `attention` BRBP-EX1 (Makefile scope exception, declared before edit):
  - Reason: `Makefile` is forbidden by default, but the 21 `publish-*-token` recipes live there and are the only place the token path can disable provenance.
  - Impact: 21 one-line recipe tails (`--access public` -> `--access public --provenance=false`); 20 additions plus normalization of `publish-cluster-mesh-token` (`--no-provenance` -> `--provenance=false`). OIDC recipes untouched, provenance stays on for OIDC publishes.
  - Rollback: revert the single `fix:` commit; token publishes return to the previous failing behavior, OIDC publishes unaffected.
  - `acknowledge`: option chosen is the explicit `--provenance=false` flag (not OIDC env forwarding), consistent with how OIDC recipes already pass publish behavior explicitly as flags (`--access public`) through the shared manifest-guard publisher. Token auth carries no OIDC identity so Sigstore provenance cannot be generated even with forwarded env, and bootstrap token publishes are already exempt from provenance qualification (`publishable-ci-wiring.test.mjs` steady-state provenance test, `rules/workflow.md` Package Publication).

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
- Rationale: single small fix, one worktree, one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in this branch, no UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `fix/bootstrap-publish-provenance` with `git -C <worktree> branch --show-current`.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`.
  - [x] Confirm failure fact: `publish-artifacts-token` runs npm in docker without OIDC env while `publishConfig.provenance=true` (all 21 packages), hence `EUSAGE / Automatic provenance generation not supported for provider: null`.
  - [x] Confirm only 2 of 21 token recipes disable provenance (`publish-cluster-mesh-token` `--no-provenance`, `publish-auth-hono-token` `--provenance=false`).
  - [x] Confirm `make ps-all` shows no running services.
  - [x] Declare BRBP-EX1 and justify the explicit-flag option.
- [x] **Lot 1 — Token-path provenance fix (test-first)**
  - [x] Extend `scripts/ci/publishable-ci-wiring.test.mjs`: every `publish-*-token` recipe passes `--provenance=false`; every OIDC `publish-*` recipe carries no provenance flag.
  - [x] Scoped run fails as expected: `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs ENV=test-bootstrap-publish-provenance` (21 pass / 1 fail on `publish-llm-mesh-token`).
  - [x] Fix `Makefile`: add `--provenance=false` to the 19 token recipes missing it; normalize `publish-cluster-mesh-token` (`--no-provenance` -> `--provenance=false`).
  - [x] Lot gate:
    - [x] Full guard suite green: `make test-publishable-manifests ENV=test-bootstrap-publish-provenance` (86 pass / 0 fail).
- [ ] **Lot N — Final validation**
  - [x] `make scope-check ENV=test-bootstrap-publish-provenance` clean (PASS C2).
  - [ ] Atomic commit via `make commit` (<=150 lines, Conventional Commits, no AI attribution).
  - [ ] Push `git push origin fix/bootstrap-publish-provenance`, open PR with `BRANCH.md` as body.
  - [ ] Watch branch CI to completion, report PR number and head SHA. Never merge, never publish, never trigger bootstrap workflow.
