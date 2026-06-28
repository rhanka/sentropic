# Feature: MCP Capability Registry Residence — P5 options draft

## Objective
Frame REVERSIBLE OPTIONS for parked decision P5 (`SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md §13.1`) — where the MCP capability registry physically lives (control-plane vs Resource-Plane; published vs internal) and how it is exposed — as a DRAFT for the architect + BR-70 owner to ratify. Planning/design only; no code, no decision.

## Scope / Guardrails
- Scope limited to a single new spec document + this `BRANCH.md`.
- No src/test/schema/package changes; no migration; planning only.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/p5-registry-residence`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Do NOT push, do NOT open a PR (planning-draft lane).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_DECISION_MCP_REGISTRY_RESIDENCE.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`, `e2e/**` (all code)
  - any other `spec/**` file
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare exception ID `P5-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- none

## AI Flaky tests
- Not applicable (no tests in this planning branch).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single planning document; no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: one orthogonal planning artifact (a single decision-options spec); no code, no CI need.

## UAT Management (in orchestration context)
- Not applicable (no UI / behavior change). Review = architect + BR-70 owner reading the spec.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read parent + adjacent specs (`SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM`, `SPEC_EVOL_CATALOG`, `SPEC_EVOL_RESOURCE_FS`).
  - [x] Ground in code (`api/src/services/catalog/**`, `api/src/services/resource-plane/**`, `api/src/services/object-registry/object-type-registry.ts`).
  - [x] Create isolated worktree `tmp/p5-registry-residence` and verify branch.
  - [x] Confirm scope and guardrails (doc-only, no push/PR).

- [x] **Lot 1 — Write the options draft**
  - [x] Write `spec/SPEC_DECISION_MCP_REGISTRY_RESIDENCE.md` with DRAFT banner.
  - [x] Scope the decision precisely (MCP provider-manifest registry, §8 flow).
  - [x] Enumerate options A (control-plane DB), B (Resource-Plane projection), C (hybrid) + B0 baseline.
  - [x] Comparison table (fits BR-59/BR-70, authoritative clarity, discovery/parity, publish blast-radius, effort, reversibility).
  - [x] Recommendation (proposal: C) with rationale.
  - [x] Reversible-vs-irreversible split.
  - [x] Open questions for architect + BR-70 owner.
  - [x] Commit doc + `BRANCH.md` atomically (`make commit`, selective add). No push, no PR.

- [x] **Lot 2 — Apply Codex 5.5xhigh review corrections (C1-C6)**
  - [x] C1 — Add `@sentropic/mcp-platform` to §1.1; make wire-shape home an explicit open decision (api-local / private scaffold / future published); stop implying `ubo-contracts` is the MCP contract home.
  - [x] C2 — Reclassify reversibility: control-plane Drizzle migration/table IS the residence commitment → moved to irreversible side; reversible-now = interface/prototype/mock.
  - [x] C3 — Split manifest-registry persistence from session/consent/enrollment persistence (separate stores, scaffold already models the latter).
  - [x] C4 — Qualify the catalog→resource-plane projection: shipped for `list/stat/read/grep`; `resolvePath`/`resolveAlias` lack the discover gate.
  - [x] C5 — Correct deny-as-missing: `provider-base.ts` only returns `unsupported`; projector is catalog-specific → MCP-specific projector still must be built.
  - [x] C6 — Add Option D (code-owned manifests + separate durable stores + projection); defer package activation/publication (P1).
  - [x] Update recommendation: Option C target, no package activation, control-plane manifest store only after P5, separate restart-safe auth/session/enrollment persistence.
  - [x] Commit doc + `BRANCH.md` atomically (`make commit`, selective add). No push, no PR.

## Deferred / Notes
- P5 stays parked (IRREVERSIBLE / owner-gated) until the architect + BR-70 owner ratify an option. No build slice may pre-empt it.
