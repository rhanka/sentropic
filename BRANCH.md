# Feature: GitHub seat credential custody study — rebase and reconciliation (PR #596)

## Objective
Rebase PR #596 onto current `origin/main` and reconcile `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` with main and PR #659, as a documentation-only change. No new custody design is selected and no runtime behavior changes.

## Scope / Guardrails
- Scope limited to `BRANCH.md` and `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` only.
- Documentation-only scope: no runtime, workflow, deployment, keyring, credential, package-version, or frozen broker edits.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/pr596-custody`.
- No services are started on this branch; no `ENV=dev` test run applies.
- UAT on this branch is a document review only; no browser, API, or E2E surface changes.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Branch: `spec/github-seat-credential-custody` (PR #596, kept open per owner instruction 2026-10-18). Rebased base: `origin/main` at `1472d961e098908e64ef60b83835af357888d031`. ENV alias: `test-pr596-custody` (no ports allocated; documentation-only).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `plan/**`
  - `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md` (FROZEN; read-only input)
  - `spec/SPEC_EVOL_*.md` (current authority; read-only reference, no edits)
  - `packages/**`
  - `apps/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `deploy/**`
  - `.github/workflows/**`
  - `track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None. No conditional path is used on this branch.
- **Exception process**:
  - Declare exception ID `BR596-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- `acknowledge` (2026-10-18): Two independent reviews of head `1019ef6020b8add72a66bf017e0dbe98e629f333` returned REQUEST_CHANGES for one shared P2 finding: the retained cost-risk instruction at study §9 read as a current pre-build gate. Fixed by marking that instruction historical and superseded (D7 no-reapproval-gate and Claude decided-continuation references); the unverified cost/terms risk is retained. Treatment record: `.h2a/reviews/pr596_treatment.md`. No other finding was raised by either review.
- `deferred`: Custody job, resolver, and live qualification remain open on main (deployable-process custody/G4 and B4). Owner: custody maintainer/conductor for G4 reconciliation; h2a owner for Claude execution qualification; platform/custody operator for preprod delivery and per-device revocation evidence. Status: recorded as existing dependencies in the study; not blockers for merging this documentation-only reconciliation. Production stays deferred under O-D3.
- No `blocked` or `attention` item is open for this branch.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- This branch runs no API, UI, E2E, or AI test: documentation-only (see Lot 4 test lists). No flaky signature is recorded.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single documentation branch (PR #596) with one study file plus this plan; no parallel workstream or independent CI lane is needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints are listed as checkboxes inside Lot 4 (document review; no UI surface).
- Execution flow (mandatory):
  - Develop and run checks in `/home/antoinefa/src/sentropic/tmp/worktrees/pr596-custody`.
  - Push branch before handoff.
  - No root-workspace UAT run applies (no UI/API change); document review happens on the pushed head.
  - Switch back to the worktree after any review.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`, `PLAN.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/pr596-custody` on branch `spec/github-seat-credential-custody` (`git branch --show-current`).
  - [x] Run `harness check branch --current-branch spec/github-seat-credential-custody --expected-branch spec/github-seat-credential-custody` (PASS C1).
  - [x] Read the comparison analysis (2026-10-18) and the controlling contracts on `origin/main`: deployable-process D7, Claude-seat spec, CI-seats five-CLI envelope, frozen broker, account administration, gateway Lot 2.
  - [x] Confirm documentation-only scope and guardrails; no ENV service mapping or ports are allocated.
  - [x] Define validation commands: `make scope-check ENV=test-pr596-custody` before each commit; final `git diff --check` and link/line-reference validation.

- [x] **Lot 1 — Rebase onto `origin/main`**
  - [x] Rebase `spec/github-seat-credential-custody` onto `origin/main` (`1472d961e098908e64ef60b83835af357888d031`), keeping the branch identity and the single study commit.
  - [x] Push with `--force-with-lease` (rebased head `0ca616db7a26733137bd4ac592bd4f45f5c22d2f`).
  - [x] Confirm the rebased diff vs `origin/main` adds only `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` (106 lines, no same-file conflict).

- [x] **Lot 2 — Reconciliation of the study (documentation-only)**
  - [x] Mark the 2026-09-20 study as historical where superseded; keep the dated owner request and the O1/O2/O3 comparison as decision history; remove O2 as the current recommendation.
  - [x] Replace the current-tense custody, refresh, and MEP delivery descriptions with references to the controlling deployable-process D7 contract (GitHub Secrets, sole refresher, GitHub-first commit, CAS delivery, access-only projection resolver, preprod-first, production deferred).
  - [x] Correct the security boundary wording: the selected Secrets design entrusts full credentials to the GitHub secret/job boundary; no KMS-to-KMS guarantee is claimed for it.
  - [x] Remove the unconditional metered-fallback and categorical terms-safety wording; keep mono-principal personal passthrough and cite the provider-specific qualification on main.
  - [x] Update the factual inventory: Muse enrollment exists on main; the five-CLI envelope (agy, codex, vibe, muse, claude) is the current provider inventory with lifecycle qualification unverified; keep direct Gemini/AI-Studio only as deferred/unverified.
  - [x] Separate delivered Claude enrollment (PR #659) from execution/host qualification (h2a runner seam; no runner installed by default; standalone host excludes provider CLI subprocesses).
  - [x] Reclassify the seven original questions as decided, historical, deferred, or still unverified, with pinned evidence per question.
  - [x] State dependencies precisely: missing custody job/resolver/lifecycle proofs are existing dependencies owned by the custody lane, the h2a owner, and the platform/custody operator; they are not delivered by PR #659 or by this study and are not prerequisites to merging this study.
  - [x] Validate every link and `file:line` reference against `origin/main` at `1472d961e098908e64ef60b83835af357888d031`.

- [x] **Lot 3 — Docs consolidation**
  - [x] Confirm `spec/BRANCH_SPEC_EVOL.md` is neither created nor modified on this branch (pre-existing file on main, untouched; reconciliation lands directly in the study).
  - [x] Confirm no other `spec/*.md` file is modified; controlling specs stay read-only references.

- [ ] **Lot 4 — Final validation and handoff**
  - [x] Run `make scope-check ENV=test-pr596-custody` before each atomic commit (commits of at most 150 lines, via `make commit`, no AI attribution).
  - [x] Review the final diff vs `origin/main` and run `git diff --check`.
  - [x] **API tests**: existing: none impacted; updated: none; new: none. No API test run applies (documentation-only).
  - [x] **UI tests**: existing: none impacted; updated: none; new: none. No UI test run applies (documentation-only).
  - [x] **E2E tests**: existing: none impacted; updated: none; new: none. No E2E run applies (documentation-only).
  - [x] Document UAT (reviewer checklist, on the pushed head):
    - [x] Open the study and confirm the status line distinguishes the 2026-09-20 historical study from the 2026-10-18 reconciliation.
    - [x] Confirm O1/O2/O3 read as historical options and no current recommendation points to O2.
    - [x] Confirm refresh and delivery wording matches D7 (sole refresher, GitHub-first commit, CAS, access-only projection, no runtime refresh of custody seats).
    - [x] Confirm fallback and terms wording carry no unconditional promise.
    - [x] Confirm the provider table matches the five-CLI envelope and marks lifecycle qualification unverified.
    - [x] Confirm each of the seven questions carries a disposition with a pinned reference.
    - [x] Confirm dependency owners (custody/G4, h2a, platform/custody operator) and the production-deferred boundary are stated.
  - [ ] Update PR #596 title/body to reflect the reconciled study (PR body: exact text of this `BRANCH.md`).
  - [ ] Push, verify PR CI is green on the final head, record the head SHA, and stop.
  - [ ] Deferred to the conductor after handoff (not executed on this branch): two independent reviews (mesh/Claude/runtime and custody/deployment/security), then the `BRANCH.md` removal commit, then merge. Never merge on this branch.
