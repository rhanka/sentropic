# Feature: Artifact source, access and terminal deletion parity

## Objective
- [ ] Implement only converged R1 D1, D2 and get/list D4 in the common artifacts package.

## Scope / Guardrails
- [x] Binding design: converged-r1.md SHA256 9c2cd0051cb28d21a4f2584175bc74c92c392d25a4c3a449057d162ec8f1bdcd.
- [x] Worktree tmp/worktrees/artifacts-parity-p0b; branch feat/artifacts-parity-p0b from origin/main.
- [x] Make only; Docker serialized on .tmp/packets/DOCKER-LOCK.md; ENV=test-artifacts-p0b last.
- [x] Ports API 9685, UI 5885, Maildev 1785; package tests do not bind ports.
- [x] No versions, revert, publication CAS, metadata writes or edits; no merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/**`
  - `BRANCH.md`
  - `package-lock.json`
  - `api/package-lock.json`
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
- [x] BRP0B-EX1 (owner CI repair): synchronize only the artifacts workspace version in root/API locks; no dependency graph change; rollback with the version fix.
- [x] BRLOCK-EX1: existing CI maintainers policy, review_by=2026-11-30T00:00:00Z; no renewal or scope expansion of the exemption.
- [x] CI 41361090041 budget step passed; its oversized baseline deliberately reimports the governance corpus. The actual artifacts failure is the ensure HTTP/MCP integration fixture missing lifecycle.stateOf.
- [x] Review r1 RED: ungranted mutation probes returned 403 instead of 404; real publication readers accepted purged releases and mismatched record digests.
- [x] Review r1 visibility GREEN: all 6 parity transport tests pass, including ungranted/missing/withdrawn 404, visible non-owner 403 and terminal delete replay.
- [x] Review r1 source GREEN: all 6 parity source tests pass; real publication readers reject purged/mismatched selected and current releases with zero blob reads.
- [x] Review r1 package gate: typecheck, lint and all 466 unit tests pass (40 files).
- [x] Review r1 SQL RED: standalone integration rejected to_jsonb(artifacts.artifacts); use an explicit row alias in both binding lookup queries.
- [x] D4 metadata reads preserve optional fields; metadata writes belong to feat/artifacts-parity-p0.
- [x] Source RED found a foreign release-record acceptance; added record/manifest identity checks and regression coverage.
- [x] Targeted source/control/transport run: 11 tests pass; broad SCOPE also selected the integration file, correctly refusing absent DATABASE_URL. The dedicated integration target is queued.
- [x] Full unit gate exposed an outdated list fixture: enrichment now reads current releases. Updated its stub and asserted that foreign scopes are filtered before release reads.
- [x] PostgreSQL initialization exceeded compose's health window; logs show initialization and checkpoint completion, and make ps now reports healthy. Retrying the targeted suite against the same stack.
- [x] Draft PR https://github.com/rhanka/sentropic/pull/878; intermediate commits skip CI; final head remains to qualify.
- [ ] Integration dependency: the D3 lane must preserve confirmation error details through the shared mcp-platform wire codec; this branch preserves them through the artifacts adapter.

## AI Flaky tests
- [x] No AI-dependent tests or timeout changes.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: this branch owns D1/D2/D4; the existing parity lane owns all other deltas.

## UAT Management (in orchestration context)
- [x] No UI changes; IMMO activation and management UI belong to the IMMO lane.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read master, workflow, testing, common rules and binding design.
  - [x] Verify branch mechanically using harness (PASS C1).
- [ ] **Lot 1 — Tests before implementation**
  - [x] packages/artifacts/tests/parity-source.test.ts: release selection, source rights, corruption and revocation.
  - [x] packages/artifacts/tests/parity-control.test.ts: targeted grants, confirmation, replay and terminal guards.
  - [x] packages/artifacts/tests/parity-transport.test.ts: selected HTTP/MCP operations and enriched summaries.
  - [x] packages/artifacts/tests/parity-store.integration.test.ts: real parent locks, targeted grants and terminal SQL guards.
- [ ] **Lot 2 — Common implementation**
  - [x] D1 verified manifest and author file reads with separate provenance (transport qualification pending).
  - [ ] D2 coordinator-bound named read grants and confirmed terminal deletion.
  - [x] Identical named grants preserve the stored modification date without replacing grants.
  - [x] D4 get/list binding, dates, digest, URLs and optional metadata.
- [ ] **Lot 3 — Final validation**
  - [ ] Scoped tests, artifacts unit suite, typecheck and lint through make.
  - [x] Ship package version 0.2.5 above published 0.2.4 and within existing artifacts peer ranges (registry checked).
  - [ ] Scope check before each atomic commit; push after each commit as explicitly requested.
  - [ ] Draft PR using this file; one final-head CI run; record exact head and result.
  - [ ] make down ENV=test-artifacts-p0b; write .tmp/rv/artifacts-parity-p0b.md and stop.
- [ ] **Lot 4 — Fix review r1 (owner request, PR 878)**
  - [x] Mask invisible set_access/delete targets through visible(); qualify HTTP/MCP ungranted and visible non-owner outcomes while preserving delete replay.
  - [x] Ship p0b as artifacts 0.2.5 per owner CI repair; retain the D1/D2/D4 CHANGELOG without touching the sibling branch.
  - [x] Rename terminal controls migration to 0004; update README and integration fixture.
  - [x] Preserve release state and manifestDigest through publication readers; reject purged/mismatched selected and current source releases before blob reads.
- [ ] **Lot 5 — Fix CI (owner request, PR 878)**
  - [x] Restore compatible artifacts 0.2.5 manifest/provider/CHANGELOG and root/API workspace lock pins.
  - [x] Qualify the actual ensure transport integration regression (7/7), full artifact budget, production API image (strict prune/audit) and lock-install guard (11/11) under the single Docker lock; make down completed.
  - [ ] Commit through make, push the final head, run one workflow_dispatch CI, record its completed result and make down.
