# Feature: cluster-mesh common storage rule — L00 docs + L01a contract

## Objective
Consolidate the approved common-rule amendment (CR-1..CR-5) into the storage spec (L00, docs only), then add the data-only common contract with fixed vectors (L01a, no backend change).

## Scope / Guardrails
- Scope limited to L00 documentation and L01a data contract as the amendment rows define them.
- No backend, encoder, adapter, SQL asset, claim, connection or credential change.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/cm-s3-common-rule`.
- Automated tests run on `ENV=test-cm-s3-l01a`, never on `ENV=dev`.
- 0 Python. One Docker build at a time.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md`
  - `packages/cluster-mesh/src/storage/common-contract.ts`
  - `packages/cluster-mesh/tests/storage/common-rule/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/src/storage/**` (except `common-contract.ts`)
  - `packages/cluster-mesh/tests/storage/**` (except `common-rule/**`)
  - `packages/artifacts/**`
  - All other `spec/**`, `packages/**`, `api/**`, `apps/**`, `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`

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
- Rationale: L00 then L01a land sequentially on one branch with atomic commits; one final CI cycle on the draft PR.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L00/L01a: UAT not applicable.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the amendment, the r3 review with its five P3 advisories, and the owner orientations.
  - [x] Create isolated worktree `tmp/worktrees/cm-s3-common-rule` on `feat/cm-s3-common-rule` from `origin/main`.
  - [x] Verify branch before any work.
  - [x] Capture Makefile targets for debug/testing.
  - [x] Define environment mapping: tests on `ENV=test-cm-s3-l01a`, never `ENV=dev`.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`); no exceptions needed.
- [ ] **Lot L00 — Documentation consolidation only (3–4 atomic commits, no code)**
  - [x] Consolidate authority, scope, surfaces, CR-1 and CR-2 into the storage spec.
  - [x] Consolidate CR-3, CR-4 and CR-5 into the storage spec.
  - [x] Record contract shape, admission, activation and the parity register.
  - [x] Record traceability, kit acceptance, sequencing and the five P3 advisories.
  - [ ] Lot gate: `make scope-check` before every commit; each commit under 150 lines.
- [ ] **Lot L01a — Data contract and fixed vectors (2–3 atomic commits, no backend change)**
  - [x] Add `packages/cluster-mesh/src/storage/common-contract.ts` data-only types/validators.
  - [x] Add `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` fixed expected vectors.
  - [x] Add `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` structural tests.
  - [ ] No encoder, adapter, SQL asset, publication path, claim, connection or credential change.
  - [ ] Lot gate: `make typecheck-cluster-mesh`, `make lint-cluster-mesh`, scoped spec run with `ENV=test-cm-s3-l01a` last.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest scoped L01a spec (`ENV=test-cm-s3-l01a`)
  - [ ] Push branch and open DRAFT PR titled `feat(cluster-mesh): common storage rule — L00 docs + L01a contract`.
  - [ ] Verify CI green on the exact head; do not merge, do not mark ready.
  - [ ] Report PR number, commits, head SHA, CI run URL, frozen contract file and its sha256.
