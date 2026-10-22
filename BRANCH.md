# Feature: #861 L0 shared contract and vectors

## Objective
Freeze the stable L0 contract shapes for #861 (profile/outcome/coordinator declarations, common-contract map, migration inventory, executable vectors).

## Scope / Guardrails
- Scope limited to packages/artifacts/** declaration shapes, docs, and unit vectors.
- Public host API names are explicitly excluded until spec r2 is forwarded.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-861`.
- Automated test campaigns run on dedicated environments (`ENV=test-artifacts-861`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/l0-freeze/profile-contract.ts`
  - `packages/artifacts/l0-freeze/commit-contract.ts`
  - `packages/artifacts/l0-freeze/failure-contract.ts`
  - `packages/artifacts/l0-freeze/command-identity-contract.ts`
  - `packages/artifacts/tests/effective-profile.test.ts`
  - `packages/artifacts/tests/commit-contract.test.ts`
  - `packages/artifacts/docs/common-contract-map.md`
  - `packages/artifacts/docs/migration-inventory-l0.md`
  - `packages/artifacts/README.md`
  - `packages/artifacts/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-auth/**`
  - `.github/workflows/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] L0-EXCLUDE-1 (acknowledge): public host API names (coordinator/outcome method names, host binding names) stay unfrozen until spec r2 is forwarded; L0 freezes shapes and vectors only
- [ ] L0-Q0 (attention): i-cond Q0 inventory (due 22 Oct 12:00 Toronto) not yet forwarded; integrate on arrival as amendment without changing frozen shapes unless r2 requires it
- [ ] L0-R2 (attention): Opus review requires spec r2 (host API naming vs radar suite, consumer baselines 0.1.2, race/isolation, error-code mapping, CR-1..CR-5); do not freeze contested names in L0
- [x] L0-CI (acknowledge): CI run 39720063546 failed on the 0.2.0-rc.1 package.json bump (probe version equality, mesh eresolve against frozen range); L0 restructured to docs plus vectors plus l0-freeze with no src or version change, bump deferred to L1

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
- Rationale: L0 is a single declaration-freeze lot with no parallel implementation workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L0; no UAT checkpoints apply.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, spec-plan.md L0 row plus sections 1-5, REQUEST-i-cond.md.
  - [x] Worktree tmp/worktrees/artifacts-861 on branch feat/artifacts-861-contracts from origin/main verified.
  - [x] ENV mapping: unit/typecheck/lint on ENV=test-artifacts-861 last argument; no services started in L0.
  - [x] Ports: no ports needed (no services in L0; declaration docs plus unit vectors only).
  - [x] Confirm scope and guardrails; public host API names excluded until spec r2.
  - [x] Validate scope boundaries with make scope-check before each commit.
- [x] **Lot 1 — Declaration shapes (stable only, no host API names)**
  - [x] packages/artifacts/l0-freeze/profile-contract.ts: selection plus effective-profile shapes, Radar four-tool subset, C4 bounds as frozen data plus validators.
  - [x] packages/artifacts/l0-freeze/command-identity-contract.ts: effective-command plus command-identity shapes, codec version, derivation-binding shape (algorithm reference only, no new API name).
  - [x] packages/artifacts/l0-freeze/commit-contract.ts: invocation-context, authorization-decision, coordinator-requirement shapes plus finalization protocol order as frozen types.
  - [x] packages/artifacts/l0-freeze/failure-contract.ts: outcome plus failure shapes, category-to-public mapping table, commit states.
  - [x] Lot gate:
    - [x] make typecheck-artifacts ENV=test-artifacts-861 last
    - [x] make lint-artifacts ENV=test-artifacts-861 last
- [x] **Lot 2 — Common-contract map without runtime cycle**
  - [x] packages/artifacts/docs/common-contract-map.md: capability, publication-condition, commitment, manifest, page reuse table plus boundaries (no registered module, scope mapping needs trusted host mapping, mesh export lives in L7, no mesh runtime dep from artifacts).
  - [x] No import of @sentropic/cluster-mesh from packages/artifacts/src or tests.
  - [x] Lot gate:
    - [x] grep verifies no cluster-mesh import in packages/artifacts/src and new tests
- [x] **Lot 3 — Migration inventory and vectors**
  - [x] packages/artifacts/docs/migration-inventory-l0.md: declaration changes per ask, migration guide stubs, legacy-record quarantine rule, Radar pilot-state inputs awaited (Q0).
  - [x] packages/artifacts/tests/effective-profile.test.ts: frozen selection plus bounds vectors (pure, no DB/S3, no app.handle).
  - [x] packages/artifacts/tests/commit-contract.test.ts: frozen failure-mapping plus finalization-order vectors (pure, no DB/S3, no app.handle).
  - [x] No integration tests; no mocked provider success.
  - [x] Lot gate:
    - [x] make test-artifacts ENV=test-artifacts-861 last (unit only: 27 files, 216 tests passed)
    - [x] make scope-check before each commit
- [ ] **Lot 4 — Release reservation and PR**
  - [x] Document the 0.2.0-rc reservation without a package.json bump (frozen mesh range until L7; bump deferred to first src-changing lot).
  - [x] Update packages/artifacts/README.md with L0 contract line pointer.
  - [x] Atomic commits via make commit MSG only, each under 150 lines, git add selective files only.
  - [x] Push branch and open DRAFT PR feat(artifacts): #861 L0 shared contract and vectors.
  - [x] CI green; do not merge.
