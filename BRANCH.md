# Feature: Deployed UI annotation overlay — spec consolidation (DV3 = B)

## Objective
- Promote the reviewed scratch spec v2 into `spec/SPEC_EVOL_UI_ANNOTATE_OVERLAY.md` without changing its design, record the closed owner decision DV3 = B (Inclure), and add cross-references from the related SPEC_EVOL files.

## Scope / Guardrails
- Scope limited to `spec/**` and `BRANCH.md` only.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Docs only on this branch: no code, deployment, publication, seed execution, or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] DV3 owner decision closed 2026-10-18: question « quand on recopie la prod vers la preprod pour tester, est-ce qu'on copie aussi tes annotations privées (texte et captures d'écran) ? » — answer « Tout copier » = option B (Inclure); no `blocked` / `attention` item remains on this branch for DV3.
- [x] Astra max review of PR #694 at `b9895373a` (NO-GO: 2 blocking P2, 2 P3) treated in this branch: canonical discussion-state separation, observed snapshot binding for third-party authoring, S7 source locator with digest and lot map, and commit-count freshness below; treatment table in `.h2a/reviews/spec694_treatment.md`.
- [x] Astra max re-review r2 of PR #694 at `df769d99a` (GO, 1 new P3) treated in this branch: Lot N-1 checkbox qualified for the intentional S7 provenance reference; findings #1–#4 remain closed.
- [ ] No other `blocked` / `deferred` / `cancelled` / `attention` item open; raise one here instead of guessing if a prerequisite is unresolved.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] Not applicable on this docs-only branch: no API, UI, or E2E test run is claimed; future lane gates are specified inside the promoted spec.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single docs-only spec promotion with cross-references; the six future implementation lanes A–F are specified inside the promoted spec and are not branches of this work.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/<slug>` after UAT.
- [x] This branch has no UI change: UAT is an owner read of the promoted spec and cross-references on the draft PR; no service start and no `ENV=dev` test run.

## Plan / Todo (lot-based)
- [x] **Round 1 dossier treatment (2026-10-18), findings 6/7**: replace stale D-P1/D-P2/D-P3 references with revision-pinned section/line citations; carry the corrected account-protection benefit, recovery prerequisites and remaining non-MFA login exposure. Namespace and host-mapping contracts stay intact.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `plan/BRANCH_TEMPLATE.md`, the scratch spec v2 (sha256 `5717b057b5d4ea78c78ffb7d77c71e50c198012b1219662b599c624e87543b11`), and the Astra re-review (verdict GO).
  - [x] Confirm isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/spec-ui-annotate-overlay` on `docs/spec-ui-annotate-overlay` from `origin/main` (`1472d961e098908e64ef60b83835af357888d031`) with `git -C <worktree> branch --show-current` and `harness check branch`.
  - [x] Confirm docs-only scope: no Makefile target starts services; verification is `make scope-check ENV=test-spec-ui-annotate-overlay` with `ENV` last; no API, UI, or Maildev port is allocated or started.
  - [x] Confirm scope and guardrails: `spec/**` + `BRANCH.md` only, commits at most 150 lines via `make commit`, no AI attribution, draft PR only, never merge.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed: none required.
- [x] **Lot 1 — Promote v2 into `spec/SPEC_EVOL_UI_ANNOTATE_OVERLAY.md`**
  - [x] Copy the section structure of `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md` and `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md` (authority/baseline header, numbered sections, tables, lots, acceptance) and carry the v2 content without changing its design.
  - [x] Record provenance: source scratch spec v2 sha256 above, Astra GO review, pinned baseline `origin/main = 1472d961e098908e64ef60b83835af357888d031`, and PR #684 M2 dependency as future gates.
  - [x] Record DV3 = B verbatim as a closed owner decision (2026-10-18, « Tout copier »); remove the pending owner question and options A/C as undecided choices.
  - [x] Keep the B consequences and controls: access controls qualified before any copy; projections rebuilt for the target tier; no active grant, session, pending delivery, or prod routing right copied; re-seed overwrites preprod annotations.
  - [x] **API tests**: existing `none`, updated `none`, new `none` on this branch; future C/E lane suites stay specified in spec sections 8–9 and are not executed here.
  - [x] **UI tests (TypeScript only)**: existing `none`, updated `none`, new `none` on this branch; future B/D/F lane suites stay specified in spec sections 8–9 and are not executed here.
  - [x] **E2E tests**: existing `none`, updated `none`, new `none` on this branch; future component and deployed-qualification suites stay specified in spec sections 8–9 and are not executed here.
  - [x] Lot gate: `make scope-check ENV=test-spec-ui-annotate-overlay` passes with only `spec/**` + `BRANCH.md` changed; no typecheck, lint, build, or test claim is made for this docs lot.
  - [ ] UAT (docs read): owner opens the promoted spec, confirms the DV3 = B paragraph states the closed decision with its controls, and confirms no pending DV3 question remains.
- [x] **Lot 2 — Cross-references**
  - [x] Add a cross-reference from `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md` to `spec/SPEC_EVOL_UI_ANNOTATE_OVERLAY.md` (canonical model consumed; UI overlay is a separate consumer spec).
  - [x] Add a cross-reference from `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` to `spec/SPEC_EVOL_UI_ANNOTATE_OVERLAY.md` (explicit `/api/v1/artifacts-mcp` audience/scope widening stays gated at E0).
  - [x] Check `spec/SPEC.md` for a SPEC_EVOL index: it lists no SPEC_EVOL index (only inline mentions), so no `spec/SPEC.md` edit is made; record this finding here.
  - [x] Lot gate: `make scope-check ENV=test-spec-ui-annotate-overlay` passes; every new link resolves to an existing file in this branch.
  - [ ] UAT (docs read): owner follows each cross-reference from the two related specs to the promoted spec and back to the canonical comments model.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Confirm the promoted spec contains no scratch-only path except the intentional, digest-pinned external S7 provenance reference (Replace-Claude v2.1 plan, sha256 recorded in spec section 1), no pending DV3 question, and no forbidden wording; confirm lane, lot, Make-command, and acceptance content matches v2.
  - [x] Confirm `BRANCH.md` checkboxes reflect the completed lots with this commit.
- [ ] **Lot N — Final validation**
  - [x] Run `make scope-check ENV=test-spec-ui-annotate-overlay` and record its result: PASS C2 on every lot, including the final tree (`spec/**` + `BRANCH.md` only).
  - [x] Confirm every commit on this branch is at most 150 changed lines and was created with `make commit` without AI attribution: 9 commits in the reviewed range `origin/main..b9895373a`, 12–102 changed lines each, no AI trailer; treatment commits after that range follow the same rule.
  - [x] Push `docs/spec-ui-annotate-overlay` and open a DRAFT PR whose body is this `BRANCH.md` text; report the PR number and stop without merging: DRAFT PR #694.
  - [x] Retest UI: not applicable, docs only, no UI test claimed.
  - [x] Retest API: not applicable, docs only, no API test claimed.
  - [x] Retest E2E: not applicable, docs only, no E2E test claimed.
  - [x] Package version bump: not applicable, no `packages/<pkg>/src/**` file changed.
- [x] **Lot V2 — Spec-review synthesis amendments (2026-10-18)**
  - [x] F694-1 namespace binding on every stored/transported record (envelope/retained reference for frozen M1 bytes)
  - [x] F694-2 cross-namespace isolation acceptance (A-vs-B retained, namespace mismatch added)
  - [x] F694-3 screen vocabulary with named app instance
  - [x] F694-4 portable any-managed-screen target with host adapter contract
  - [x] F694-5 Sentropic serialization lineage for C-storage and DV3
  - [x] F694-6 method-neutral MFA consumption with #695 and M-3 qualification
  - [x] F694-7 shared-installation bound and catalogue relationship
