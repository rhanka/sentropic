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
- [x] Review r1 RED: ungranted mutation probes returned 403 instead of 404; real publication readers accepted purged releases and mismatched record digests.
- [x] Review r1 visibility GREEN: all 6 parity transport tests pass, including ungranted/missing/withdrawn 404, visible non-owner 403 and terminal delete replay.
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
  - [x] Bump package version to 0.3.0 above published 0.2.4 (registry checked).
  - [ ] Scope check before each atomic commit; push after each commit as explicitly requested.
  - [ ] Draft PR using this file; one final-head CI run; record exact head and result.
  - [ ] make down ENV=test-artifacts-p0b; write .tmp/rv/artifacts-parity-p0b.md and stop.
- [ ] **Lot 4 — Fix review r1 (owner request, PR 878)**
  - [x] Mask invisible set_access/delete targets through visible(); qualify HTTP/MCP ungranted and visible non-owner outcomes while preserving delete replay.
  - [ ] Keep p0b as first artifacts 0.3.0 release; ship a D1/D2/D4 CHANGELOG without touching the sibling branch.
  - [ ] Rename terminal controls migration to 0004; update README and integration fixture.
  - [ ] Preserve release state and manifestDigest through publication readers; reject purged/mismatched selected and current source releases before blob reads.
