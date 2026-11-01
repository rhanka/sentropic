# Feature: cyber-act-L02 downstream patched scanner

## Objective
Produce and admit the sentropic downstream patched Trivy image contract per r6 section 3.

## Scope / Guardrails
- Scope limited to scanner policy profile, offline verifier, recipe, promotion workflow, receipts.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.security/trivy-toolchain.json`
  - `scripts/security/daily/toolchain-contract.mjs`
  - `scripts/security/daily/toolchain-contract.test.mjs`
  - `scripts/security/daily/scanner-provenance.test.mjs`
  - `scripts/security/daily/scanner-image-publish.test.mjs`
  - `scripts/security/scanner/**`
  - `docs/security/scanner-images/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `docs/security/sec-s2b-qualify/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `BR02-EX1`: touch `.github/workflows/security-scanner-image.yml` only (new file, r6 section 3.2/3.3.1 required destination).
  - Reason: r6 mandates this exact workflow path for builder, validator, publisher jobs.
  - Impact: new workflow with workflow_dispatch only, no push/schedule/PR trigger, least-privilege per-job permissions.
  - Rollback: delete the file, policy stays upstream-only and qualified false.

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
- Rationale: Single lot ACT-L02, one review-ready head, one CI run.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read r6 sections 3, 7.2 ACT-L02, 7.3 T5-S1-S6, T6-S1, retained L2-A-E.
  - [ ] Confirm worktree `tmp/worktrees/cyber-act-L02` on branch `feat/cyber-act-L02` from `origin/main`.
  - [ ] Confirm ENV `test-cyber-L02` with ports API_PORT=8811 UI_PORT=5211 MAILDEV_UI_PORT=1111.
  - [ ] Confirm scope boundaries and BR02-EX1 before touching conditional paths.
  - [ ] Record base HEAD `1239f291f` in this file.
- [ ] **Lot 1 — RED tests first**
  - [ ] Extend `scripts/security/daily/toolchain-contract.test.mjs` for dual publisher profile.
  - [ ] Add `scripts/security/daily/scanner-provenance.test.mjs` for T5-S1/S2/S3/S5/S6 and T6-S1 offline/content cases.
  - [ ] Add `scripts/security/daily/scanner-image-publish.test.mjs` for T5-S4 and T6-S1 job/artifact/publication cases.
  - [ ] Prove RED locally before implementation.
  - [ ] Lot gate:
    - [ ] `make typecheck` scoped where applicable ENV=test-cyber-L02
    - [ ] Targeted node test run under flock ENV=test-cyber-L02
- [ ] **Lot 2 — Policy, verifier, recipe, promotion workflow**
  - [ ] Extend `.security/trivy-toolchain.json` with upstream/sentropic-patched publisher profile, qualified false.
  - [ ] Extend `scripts/security/daily/toolchain-contract.mjs` with strict profile validation.
  - [ ] Add `scripts/security/scanner/recipe.json` and material manifest with pinned inputs.
  - [ ] Add `.github/workflows/security-scanner-image.yml` with builder, validator, publisher jobs per r6.
  - [ ] Add `docs/security/scanner-images/` qualification evidence placeholders with blocked admission.
  - [ ] No schedule enablement, no live digest invented, no seat operation.
  - [ ] Lot gate:
    - [ ] Targeted node test run under flock ENV=test-cyber-L02
    - [ ] `make scope-check ENV=test-cyber-L02`
- [ ] **Lot N — Final validation**
  - [ ] Typecheck and lint impacted scopes.
  - [ ] Retest targeted suites ENV=test-cyber-L02.
  - [ ] `make scope-check ENV=test-cyber-L02`.
  - [ ] Final gate step 1: create draft PR with BRANCH.md text as PR body.
  - [ ] Final gate step 2: run ONE CI on final head and resolve blockers.
  - [ ] Final gate step 3: report only, no merge, remove nothing.
