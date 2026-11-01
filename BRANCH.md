# Feature: RC2.registry canonical Sessions registry

## Objective
Implement the single canonical Sessions registry with typed projections (§3.3.1), exported through SessionOriginRegistryPortV1, behind the frozen RC2 contract shape, fail-closed on source-gaps.

## Scope / Guardrails
- Scope limited to canonical registry, typed listing projection, freshness scheduler, SessionOriginRegistryPortV1, observation emit.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/rc2-registry` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Contract pins: plan v1.6 draft sha256 6168b73ba9b236530bde6bb4998929de1ede0c92d61aa0fc07fcd4f9983b7b18; RC2-CONTRACT.md sha256 3d827eaa4322cd980509679f91b65d3740568c5faaf6dd29339ad99b4a46015d; manifest JSON sha256 5e86b2a114052eae27aebef913af9dd7c208c3c675609060009c542774ea568d; assignment dfb2589969f78cf0 prefix NOT observed (drift recorded in Feedback Loop); app ACK review .h2a/reviews/rc2-contract_app-ack_spark.stdout.md VERDICT ACK with RC2.registry START scoped.
- Contract inputs used: listing/registry/snapshot/descriptor/log-ref/lifecycle/freshness/projection-ACK schemas; coarse allowlist (contract §7); 5000ms scheduler with 15000ms bound (contract §7); grant/ACK/withdrawal rules (contract §7); origin-registry port methods + observation emit (contract §8).
- Source-gaps stay fail-closed (refuse), never invented: DEP-FED (H2-I/F1/F2/F15), DEP-AUTH-B/M0 (H1-H4/L1-L2/admission/executor custody), DEP-AUTH-A/A2.0b, SG-R15, N1/N4/N5 packed exports, DEP-RESIDENCE/RCP.
- Re-verify contract manifest hash before each push.
- ENV=test-rc2-registry always LAST; make down after; at most 2 build lanes; one CI per final head; push often (crash safety); secrets by NAME from .env only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/sessions/registry*.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/remote-session/registry.spec.ts`
  - `api/tests/api/session-remote-view.test.ts`
  - `ui/tests/session-content/navigation.test.ts`
  - `BRANCH.md`
  - `package-lock.json`
  - `api/package-lock.json`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/mcp-platform/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record rationale, impact and rollback in Feedback Loop before exceptions.

## Feedback Loop
- [ ] `attention`: manifest pin drift — assignment cites dfb2589969f78cf0 prefix; observed MANIFEST pins contract 3d827eaa… and manifest JSON 5e86b2a1…; using observed freeze per app ACK review §1 finding 2.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single registry slice with one writer; no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/rc2-registry`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/worktrees/rc2-registry` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES.md, plan v1.6 draft lot row RC2.registry, contract freeze, app ACK review.
  - [x] Create isolated worktree `tmp/worktrees/rc2-registry` on feat/rc2-registry from origin/main 455813bf9.
  - [x] Verify branch feat/rc2-registry.
  - [x] Capture Makefile targets: make typecheck-cluster-mesh, make test-cluster-mesh, make build-cluster-mesh, make down, make commit, make scope-check.
  - [x] Define environment mapping (test-rc2-registry) and ports for this branch.
  - [x] Confirm command style: `make ... ENV=test-rc2-registry` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
- [ ] **Lot 1 — Canonical registry + SessionOriginRegistryPortV1**
  - [x] Write failing tests first in `packages/cluster-mesh/tests/remote-session/registry.spec.ts` (REGISTRY-PARTITION / REGISTRY-STALE / REGISTRY-SPLIT-BRAIN / REGISTRY-LISTING; allowlist, forbidden-field absence, stage refusals, source ACK, expiry/withdrawal, subscriber/cache teardown; dedupe/tombstone, sole writers, freshness carrier; scheduler 5000ms emissions, no catch-up burst, no 15000ms extension, no native ingest calls).
  - [x] Write failing paired selectors in `api/tests/api/session-remote-view.test.ts` (grant-state rows, read-loss downgrade).
  - [x] Write failing paired selectors in `ui/tests/session-content/navigation.test.ts` (coarse/activated/downgrade rows).
  - [x] Implement `packages/cluster-mesh/src/sessions/registry.ts` (sole-writer ingest, deterministic join, tombstone dominance, quarantine on conflicting hash, freshness scheduler owned by origin writer, renewFreshness as internal/test trigger, fail-closed source-gaps).
  - [x] Export port through `packages/cluster-mesh/src/index.ts`.
  - [x] Bump `packages/cluster-mesh/package.json` patch for src change.
  - [ ] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-rc2-registry`
    - [ ] **API tests**
      - [ ] Evolve `api/tests/api/session-remote-view.test.ts` (new REGISTRY-LISTING selectors)
      - [ ] Sub-lot gate: scoped api run for that file
    - [ ] **UI tests (TypeScript only)**
      - [ ] Evolve `ui/tests/session-content/navigation.test.ts` (new REGISTRY-LISTING rows)
      - [ ] Sub-lot gate: scoped ui run for that file
    - [ ] **Cluster-mesh tests**
      - [ ] New `packages/cluster-mesh/tests/remote-session/registry.spec.ts`
      - [x] Sub-lot gate: `make test-cluster-mesh ENV=test-rc2-registry` (17/17 PASS)
    - [ ] `make down ENV=test-rc2-registry` after
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest cluster-mesh (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
