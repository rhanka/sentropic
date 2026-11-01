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
- Contract pins (binding, r2 — re-pinned per conductor instruction on the ACCEPTED r2): MANIFEST seal sha256 133e23f54d7268c104fe45be753d2ea28b402b8621beefab95ed35062d84318e; plan v1.6 draft sha256 6168b73ba9b236530bde6bb4998929de1ede0c92d61aa0fc07fcd4f9983b7b18; RC2-CONTRACT.md sha256 cc8965c9affad415c35261d1909489ab12a4db15b33296a9e1dba8b6952544d0; manifest JSON sha256 f7e4a148aef4db2732d770b723751e9f8f9fb6a2dffcfdaac12913498915a23a; CHANGES-r2.md sha256 c618df116c7a35f30a974e7e48ab3c91aff0d016d3ef7d45b2921e9e5bf24 (all under /home/antoinefa/src/h2a/tmp/h-cond/rc2-contract/); app ACK review .h2a/reviews/rc2-contract_app-ack_spark.stdout.md VERDICT ACK (r1 lineage, preserved in r1-baseline.json: r1 MANIFEST dfb2589969f78cf040e8b3f0857cd933722aff5ad5445553ac42b7ba583abbed, contract 3d827eaa…, manifest JSON 5e86b2a1…).
- r2 re-pin scope (CHANGES-r2.md / changes-r2.json): in-scope registry schema deltas are $comment-only; applied exactly the r2 semantic deltas — exact runtime port signatures (single named parameter object + options?: { signal?: AbortSignal }, Promise results, synchronous emit, TypeError only on invalid JS API use), freshness interval rule W-P2-1 (expiresAt <= min(issuedAt+15000, G-5000); A stops at now >= min(expiresAt, G-5000) or age >= 15000ms; reject nonpositive intervals and unknown clock confidence), revision counter W-P1-1 (integer-exhaustion refusal; writerEpoch never resets originRevision; duplicates allocate nothing), exact digest domains (cluster-mesh.session-listing/1/coarse-v1\0 over JCS(coarse projection), exposed as projectionDigest; activated snapshot digest stays fail-closed without an enrolled origin key). Source-gaps stay fail-closed.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
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
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).
- **Exceptions granted**:
  - `BR01-EX1` (`package-lock.json`, root): mechanically required sync of the `packages/cluster-mesh` 0.26.0-dev.5 version bump via `make lock-root`; CI train lock-sync gate fails without it. Reason: enforce-package-bump companion. Impact: version field sync only (verify diff). Rollback: `git checkout HEAD -- package-lock.json` + revert version bump.
  - `BR01-EX2` (`packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` + `package-lock.json`): mechanically required companion of the same version bump; CI packaging gate (`prepare-artifacts`, lazy lanes) resolves the candidate tuple from these fixtures. Precedent: dev.3 lane commit 8dee07193. Impact: single dep spec line + regenerated lock (verify diff). Rollback: `git checkout HEAD -- packages/cluster-mesh/tests/packaging/fixtures/selected/`.

## Feedback Loop
- [x] `attention`: manifest pin drift — assignment cites dfb2589969f78cf0 prefix; r1-baseline.json confirms it as the r1 MANIFEST seal; contract 3d827eaa… and manifest JSON 5e86b2a1… are the r1 pinned bytes per app ACK review §1 finding 2. Resolved by the r2 re-pin above (r1 kept as lineage only).
- [x] `attention`: r2 reseal observed mid-lot (CHANGES-r2.md, contract cc8965c9…, manifest JSON f7e4a148…). Re-pinned to the ACCEPTED r2 (MANIFEST 133e23f5…) per conductor instruction; in-scope r1→r2 schema deltas verified $comment-only via changes-r2.json; only the r2 semantic deltas were adjusted in code (port signatures, W-P2-1 freshness margin, W-P1-1 exhaustion refusal + digest domains). r2 listing digest vector (vectors/registry-revision-digests.json, 226ad2fe…) reproduced exactly in tests.
- [x] `attention`: rebased onto origin/main a67778379 (merge-tree showed BRANCH.md as the sole conflict; `-X theirs` kept the branch version per conductor rebase rule; every other file is a strict union — no main code or tests dropped). Post-Rebase Gate: packages/cluster-mesh 0.26.0-dev.5 > npm published 0.25.0 (verified via `npm view @sentropic/cluster-mesh version`).
- [x] `blocked`: PR #873 `pull_request` events (opened, close, reopen, 2x synchronize) created no CI run (anomaly open for owner; precedent packet allows `workflow_dispatch` fallback). CI green via dispatch run 41325626558 on pre-rebase head ce9c8b7e0: previous dispatch failures fixed in-branch (root lockfile sync BR01-EX1, fixture tuple refresh + BRLOCK-EX1 line + artifacts baseline BR01-EX2).

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
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh ENV=test-rc2-registry`
    - [x] **API tests**
      - [x] Evolve `api/tests/api/session-remote-view.test.ts` (new REGISTRY-LISTING selectors)
      - [x] Sub-lot gate: scoped api run for that file (2/2 PASS)
    - [x] **UI tests (TypeScript only)**
      - [x] Evolve `ui/tests/session-content/navigation.test.ts` (new REGISTRY-LISTING rows)
      - [x] Sub-lot gate: scoped ui run for that file (4/4 PASS)
    - [x] **Cluster-mesh tests**
      - [x] New `packages/cluster-mesh/tests/remote-session/registry.spec.ts`
      - [x] Sub-lot gate: `make test-cluster-mesh ENV=test-rc2-registry` (17/17 PASS)
    - [x] Extra gates: `make typecheck-api`, `make lint-api`, `make lint-ui` (all PASS)
    - [x] `make down ENV=test-rc2-registry` after
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest cluster-mesh (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
