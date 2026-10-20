# Feature: Spec consolidation — cluster-mesh MCP registry and artifacts provider (merged PR #679)

## Objective
- Consolidate into `spec/` what PR #679 merged on `main` at `1472d961e`: the host-embedded MCP provider registry, the `sentropic.artifacts` provider, the RFC 8693 token exchange, and the verbatim owner decisions.
- Docs only: preserve the merged baseline, distinguish owner-decided requirements from remaining implementation proposals, and retain Sentropic's artifact address/DNS/TLS ownership and reader business-rights boundary.
- Apply the 2026-10-19 owner decisions G1=1, G2=1, G3=a and H1=both to this PR's specification boundaries; retain unresolved domain names, DNS GO and Sentropic-owned anchor-contract details.

## Scope / Guardrails
- Scope limited to `spec/**` and `BRANCH.md`.
- One migration max in `api/drizzle/*.sql` (if applicable): not applicable, no migration.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/spec-mcp-registry-artifacts` (branch `docs/spec-mcp-registry-artifacts`, baseline `origin/main` at `1472d961e`).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`: no test campaign on this docs-only branch.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off): not applicable, no UAT surface.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Never merge this branch; deliver a draft PR only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
  - `api/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`
- [x] `attention`: the verbatim phrase « Tout en artifacts » is required by the launch packet but was not found in the scratch sources read (`spec-v8.md`, `registry-entry-contract-v9.md`, `owner-decisions-T1-T8.md`, owner addendums); the spec quotes it with the launch packet as its source and flags the source gap in place.
- [x] `clarification` (owner, 2026-10-19): the requested main merge imports upstream files outside the authored documentation scope. Pre-merge `make scope-check` reports those inherited paths; harness scope against `origin/main` verifies the actual PR delta. No upstream file was manually edited; the merge is isolated from the atomic spec amendments.
- [ ] `deferred` (Sentropic maintainer, before readiness/merge): formal harness consensus was not established. Exact author/reviewer model metadata was unavailable for eligible peer selection; `.h2a/reviews/pr692-owner-decisions-20261019.md` records `selection-failed` against specification head `9f805c482`. No reviewer verdict or consensus approval is claimed; this does not change the owner's draft-only delivery instruction.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] Not applicable: docs-only branch, no test run, no flaky test accepted.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single docs deliverable on one branch, one draft PR, no sub-workstream.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist): no UI change on this branch, no UAT step.
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch: not selected.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/spec-mcp-registry-artifacts`.
  - Push branch before UAT: draft PR opened after push; no UAT follows.
  - Run user UAT from root workspace (`ENV=dev`): not applicable.
  - Switch back to `tmp/worktrees/spec-mcp-registry-artifacts` after UAT: not applicable.

## Plan / Todo (lot-based)
- [x] **Lot 5 — Owner decisions (2026-10-19)**
  - [x] Verify PR #692 is draft/open on `docs/spec-mcp-registry-artifacts` at `261aaed6ed2a8652fdadef5107d72022240aa1cf`; `harness check branch` passes; fetch `origin`.
  - [x] Merge `origin/main` at `f5c4c36a6` (918 commits behind) without conflicts; no manual changes to inherited main files. Track containment passes for both parents (342/342 events); Track writes remain with the designated writer.
  - [x] Amend `spec/SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md`: dated verbatim decisions, federated authority, Engram/DS producer split and Sentropic annotation-model ownership; preserve the #679 historical record. All G1/G2/G3/H1 apply to #692; #694 implementation/transfer and #596 custody changes remain in their owning PRs.
  - [x] Amend `spec/SPEC_PROPOSAL_ARTIFACT_VIEW_HOSTING.md`: both domain modes per app, independent API-transport proposal, no exclusive A/B recommendation; domain names and exact DNS GO remain open. Include authorized storage/namespace bindings, mode/domain migration and qualification of one app in both modes followed by a second app without a fork.
  - [x] Author review: all four decision quotes match the dated source verbatim; superseded alternatives removed; H1 names/DNS GO and G3 anchor details remain open. `make scope-check`, harness branch/PR-delta scope checks and `git diff --check` pass. Formal peer review is separately deferred in Feedback Loop.
  - [x] API/UI/E2E tests, typecheck, runtime lint and UAT: not applicable to documentation-only amendments; no service or port allocation, checks use `ENV=test-spec-mcp-registry-artifacts`.
  - [x] Commit through `make commit`: main integration `276144e73`, governance/annotation `1e00057d5` (69 changed lines), hosting `9f805c482` (85 changed lines). Specification head pushed and verified on PR #692, draft/open/unmerged; CI `39349132558` observed in progress. PR body is sourced from this file; final metadata commit/head and latest CI state are reported in the delivery handoff.

- [x] **Round 1 dossier treatment (2026-10-18), findings 1/2/6/7**: restore the APP_CATALOG Q4 app kind and AppCatalogSource trace; consume host screen and server recipient bindings; pin D-P1/D-P2/D-P3 citations and balance the copied D-P3 tradeoff. Documentation only; no product qualification claimed.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant rules files (`rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`) and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated worktree `tmp/worktrees/spec-mcp-registry-artifacts` and branch `docs/spec-mcp-registry-artifacts` at `1472d961e` via `git -C <worktree> branch --show-current`.
  - [x] Capture Makefile targets needed for this branch: `make commit`, `make scope-check`.
  - [x] Define environment mapping and ports for this branch: docs-only, no service started, no port allocated, no `ENV` used.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last (no service command run).
  - [x] Confirm scope and guardrails: `spec/**` and `BRANCH.md` only.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed: none.
  - [x] Read 3 neighbouring specs for conventions: `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`, `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md`, `spec/SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md` (plus `spec/SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`).

- [x] **Lot 1 — Repo spec for merged PR #679**
  - [x] Create `spec/SPEC_EVOL_CLUSTER_MESH_MCP_REGISTRY_ARTIFACTS.md` covering: host model (Immo first host), provider registry contract (`select`/`configure`/`compile`, `sentropic.artifacts`, `./mcp/artifacts`, 15 `artifacts_*` tools), artifacts provider (storage, ACL, releases, activation tickets), host-supplied identity/storage/content domain/TLS/activation, RFC 8693 token exchange (cache, invalidation), published versions, verbatim owner decisions, follow-ups #688/#689, second-host section (Sentropic app, host model only).
  - [x] Copy the section structure of `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` and `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (status/authority header, numbered sections, evidence baseline, owner decisions, acceptance, source ledger).
  - [x] Add cross-references to the new spec from the related SPEC_EVOL files (`SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md`, `SPEC_EVOL_CLUSTER_MESH_LAZY_SURFACE.md`, `SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md`, `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`); `spec/SPEC.md` keeps no SPEC_EVOL index (verified: 2 inline mentions only), so no index entry is added there.
  - [x] Trace every statement to merged code at `1472d961e` (file refs) or to a quoted owner decision; mark unmerged items as follow-up.
  - [x] Lot gate (docs-only resolution: runtime/UAT checks marked resolved-none with their explanation; no test or UAT run applies to this branch):
    - [x] `make scope-check` passes (changes limited to `spec/**` + `BRANCH.md`).
    - [x] **API tests**: none — resolved, not applicable (docs only): — existing: none modified; updated: none; new: none (docs only).
    - [x] **UI tests**: none — resolved, not applicable (docs only): — existing: none modified; updated: none; new: none (docs only).
    - [x] **E2E tests**: none — resolved, not applicable (docs only): — existing: none modified; updated: none; new: none (docs only).
    - [x] UAT: none — resolved, not applicable (no impacted surface).

- [x] **Lot 2 — Delivery**
  - [x] Commit in slices of at most 150 lines via `make commit MSG="docs: ..."` (selective `git add`, `BRANCH.md` checkboxes updated within each commit).
  - [x] Push `docs/spec-mcp-registry-artifacts` and open a draft PR reporting its number.
  - [x] Lot gate: copy of Lot 1 gate (`make scope-check`), no UAT (last lot, docs only).
  - [x] Final validation (docs-appropriate): PR body sourced from exact `BRANCH.md` text; branch CI verified on PR #692 (run 39086831064, success); `git diff --check` clean. Merge and BRANCH.md removal: not applicable under the draft-only instruction (Scope / Guardrails).

- [x] **Lot 3 — Amendment v2: catalogue integration (2026-10-18)**
  - [x] F692-1: catalogue projection of the host registry (five existing kinds plus the APP_CATALOG Q4 app-template kind, transverse columns).
  - [x] F692-2: owner-facing permission-filtered catalogue view at the D13 `/catalog` + `/apps` boundary.
  - [x] F692-3: managed-app adoption matrix in §11 (one row per app, evidence status `unverified`).
  - [x] F692-4: shared glossary and "pages" repair; « Tout en artifacts » recorded from the 2026-10-18 feedback.
  - [x] F692-5: storage and serialization ownership (generic module-storage target; no shared-app DB service).
  - [x] F692-6: annotations and per-app MFA connection (three distinct facts; open owner questions kept in French).
  - [x] F692-7: terminology repair (`SPEC_EVOL_MCP_PLATFORM_ACTIVATION.md:7`) and dated status layer (#688 merged, #689 open).
  - [x] Push and amendment-to-commit table in `.h2a/reviews/pr692_amend-v2.md` (gitignored, not committed).

- [x] **Lot 4 — Generic view hosting proposal (owner brief `AGENT_SIG:7f3a9c2e1b`)**
  - [x] Verify branch with `harness check branch`; read D5, #703 content code, #861 dossier/annex and governance boundaries.
  - [x] Preserve all seven verbatim owner inputs and the final framing: D5 covers developer UAT/previews, not later artifact views; domain/API remain open, while Sentropic/package ownership, host configuration and Data=C are decided.
  - [x] Specify package-owned configuration, DNS/TLS reconciliation, reader BFF, cookies/CORS/CORP and source-versus-proposal boundaries in `spec/SPEC_PROPOSAL_ARTIFACT_VIEW_HOSTING.md`.
  - [x] Reconcile two independent design passes (decision provenance/DNS and browser authority), renewed for the final framing: qualify A's stable-storage benefit, release attribution and B's identity adapter. Formal review across different hosts was not established; no consensus approval claimed.
  - [x] Gate: inspect the documentation diff, run `make scope-check` and `git diff --check`; scope remains `spec/**` and `BRANCH.md` only.
  - [x] Delivery: proposal revision `c30c50345` (80 changed lines) committed via `make commit` and pushed; PR #692 remote HEAD verified, draft/open, CI run `39182658557` observed queued. No merge; final handoff reports the latest delivery HEAD and CI status.
  - [x] Runtime tests/UAT: not applicable to this specification-only change; future qualification criteria are explicit in the proposal.
  - [x] Final framing amendment: compare A/B across security, cookies/CORS/CORP, DNS/TLS, developer/agent experience, package cost and reversal; cite file:line sources and recommend B as a new proposal with its strongest counter-argument.
  - [x] Cookie-tossing input (2026-10-19, `AGENT_SIG:7f3a9c2e1b`): preserve the radar-immobilier quotation verbatim; weigh the factual risk, proposed `__Host-` app-cookie migration, per-app feasibility/evidence gaps and cost in A/B; preserve orientation, D5's argument-only scope and one proposal recommendation without preselection.
