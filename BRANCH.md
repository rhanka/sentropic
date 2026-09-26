# Feature: CI registry visibility waits, publish conflict and provenance commit check

## Objective
Make post-publication registry waits cache-bypassing with a configurable ~180 s budget, retry registry-not-yet-visible PEERS installs, treat an equal-bytes publish conflict as already published (never green otherwise), and verify the SLSA provenance source commit after publication.

## Scope / Guardrails
- Scope limited to `scripts/ci/**`, Makefile registry-wait recipes (BRCIW-EX1) and ci.yml provenance wiring (BRCIW-EX3).
- No migration.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/registry-visibility-waits`.
- Automated tests run with `ENV=test-registry-waits`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- No push, no PR, no merge, no publish (conductor-owned).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRCIW-EX1: registry-wait recipes only)
  - `.github/workflows/ci.yml` (BRCIW-EX3: provenance check wiring only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge` BRCIW-EX1 (Makefile): reason = registry waits (`wait-llm-gateway-mesh-dependency`, `wait-llm-gateway-auth-dependencies`, `qualify-published-install` wait budget and provenance variable) used a cached 60 s budget; impact = CI publish/qualification recipes only; rollback = revert the Makefile hunks.
- [x] `acknowledge` BRCIW-EX2 (`scripts/ci/**`): reason = registry client, publish conflict, qualification retries and provenance check live there; impact = CI guard scripts and their fixture tests; rollback = revert the commits.
- [x] `acknowledge` BRCIW-EX3 (ci.yml): reason = pass `QUALIFY_PROVENANCE_SHA="$GITHUB_SHA"` to the steady-state OIDC post-publication qualification of mcp-auth and cluster-mesh; impact = two run lines; rollback = drop the variable.
- [ ] `attention` `packages/llm-gateway/scripts/auth-registry.mjs` is not modified (a change would need a llm-gateway bump): cache bypass is applied through `npm_config_prefer_online=true` and the 18 x 10 s budget from the Makefile recipe.
- [ ] `attention` an equal-bytes publish conflict writes receipt `status=skipped` (plus `conflict=equal-integrity`) so the existing ci.yml status handling applies unchanged; post-publication qualification then follows the existing `skipped` rules.
- [ ] `attention` bootstrap token publications (`--no-provenance`) do not get the provenance check: the variable is only wired in the steady-state OIDC jobs.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one small CI lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm worktree `tmp/registry-visibility-waits` on branch `ci/registry-visibility-waits`.
  - [x] Declare BRCIW-EX1/EX2/EX3.

- [ ] **Lot 1 — Registry visibility waits**
  - [x] Fresh registry requests send `cache-control: no-cache` with a cache-busting query; shared 18 x 10 s budget; `wait` subcommand.
  - [x] Makefile mesh/auth waits use the bypassing wait and the configurable 18 x 10 s budget.
  - [x] qualify-published-install: 18 x 10 s primary wait (configurable), core/PEERS installs retried on ETARGET/E404/notarget within the budget, other errors fail immediately.

- [ ] **Lot 2 — Publish conflict**
  - [ ] commandPublish: version conflict re-reads registry integrity without cache; equal = skipped, different = failure, unreadable after budget = failure.
  - [ ] Tests: auth error, network error, different bytes, unreadable integrity fail; equal bytes pass.

- [ ] **Lot 3 — Provenance source commit**
  - [ ] Post-publication qualification compares the SLSA v1 `resolvedDependencies[].digest.gitCommit` with `QUALIFY_PROVENANCE_SHA`.
  - [ ] ci.yml steady-state mcp-auth and cluster-mesh qualification pass `QUALIFY_PROVENANCE_SHA="$GITHUB_SHA"`.

- [ ] **Lot N — Final validation**
  - [ ] `make test-publishable-manifests ENV=test-registry-waits`
  - [ ] `make test-qualify-published-install ENV=test-registry-waits`
  - [ ] `make check-ci-version-filters ENV=test-registry-waits`
  - [ ] `make scope-check ENV=test-registry-waits`
