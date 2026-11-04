# Feature: Persistent reader consent (lot 1a, train-ready core)

## Objective
Persistent basket consent per (reader account, artifactId, scope): the reader screen is skipped only when a live consent at the current scope version meets fresh rights; suspension or withdrawn share refuses despite consent; revocation via API and one new MCP tool takes effect on the next call under any live cookie.

## Scope / Guardrails
- Lot 1a only: generic package slice (consent record, port, evaluator, tables, Postgres adapter, memory double, Gate B helper, grant service, API revocation, one MCP tool) plus the sentropic `api/` binding. Immo screen/binding, F14 cluster-mesh wiring and the silent `/__reader/renew` browser run land in lot 1b.
- Binding review corrections: lot split applied (no within-a-day claim for the full lot); `mcp-core.ts:275` re-pointed to `:229`; `reader-storage.ts:9` re-pointed to `:11`.
- Wagon lanes do not bump versions and do not regenerate locks, the APP-P1 pin, fixtures or the L5 manifest; the train integration lane does that once.
- Existing MCP tool definitions stay byte-identical; only the one appended `artifacts_revoke_reader_consent` definition is new, static and frozen.
- Make-only workflow; one Docker lock per make command (`flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ...`), never nested, never a chained multi-target flock; tests on `ENV=test-reader-consent` only, ENV always last; `make down-volumes ENV=test-reader-consent` at the end, including on failure. No `[skip ci]` anywhere.
- Branch development happens in worktree `tmp/worktrees/reader-consent` (branch `feat/reader-consent-persistent` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts/src/server/consent.ts` (new: record, scope rules, pure evaluator, Gate B helper)
  - `packages/artifacts/src/server/reader-store.ts` (new: ArtifactReaderStore port, memory double, fail-closed resolver)
  - `packages/artifacts/src/adapters/postgres-reader-consent.ts` (new: reference Postgres adapter, consent slice)
  - `packages/artifacts/sql/reader-consent.sql` (new: unnumbered table body; the train numbers the migration at land time)
  - `packages/artifacts/src/server/ports.ts` (re-export of the reader store port only)
  - `packages/artifacts/src/profile/contracts.ts` (append one capability name)
  - `packages/artifacts/src/profile/radar.ts` (append one operation profile)
  - `packages/artifacts/src/profile/schemas.ts` (append one schema case)
  - `packages/artifacts/src/profile/index.ts` (append one route mapping)
  - `packages/artifacts/src/mcp-core.ts` (append one static definition, one executor case, idempotency list entry)
  - `packages/artifacts/src/http.ts` (optional `readerConsent` dep plus one route branch)
  - `packages/artifacts/tests/reader-consent*.test.ts` (new)
  - `packages/artifacts/tests/fixtures/reader-consent-world.ts` (new)
  - `packages/artifacts/tests/snapshots/tools-list-catalogue.json` (RC-EX1: append one tool entry, pre-existing bytes unchanged)
  - `api/src/services/artifacts/reader-consent.ts` (new: grant service binding, list/revoke/revoke-all)
  - `api/src/services/artifacts/composition.ts` (wire the Postgres reader-consent store)
  - `api/src/routes/namespaces/artifacts.ts` (control-origin list/revoke routes)
  - `api/tests/api/artifacts-reader-consent.test.ts` (new, memory-store service test)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `packages/artifacts/package.json` (no version bump; train assigns 0.2.13)
  - `packages/artifacts/CHANGELOG.md` (train writes the entry)
  - `package-lock.json`, `api/package-lock.json` (no lock regeneration)
  - `api/src/services/mcp/cluster-registry.ts` (no APP-P1 re-pin)
  - `packages/artifacts/migrations/*.sql` (no pre-assigned migration number)
  - `packages/cluster-mesh/**` (F14 wiring is lot 1b)
  - `tools/memory-mcp-l5/**` (no L5 manifest regeneration)
  - `packages/**/tests/packaging/fixtures/**` (no fixture re-pin)
  - every pre-existing entry of `ARTIFACTS_TOOL_DEFINITIONS` and `tools-list-catalogue.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/artifacts/src/adapters/postgres.ts` (only if the store needs a shared helper; prefer a standalone adapter)
- **Exception process**:
  - Declare exception ID `RC-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- RC-EX1 (scope exception, `packages/artifacts/tests/snapshots/tools-list-catalogue.json`): the new `artifacts_revoke_reader_consent` definition must appear in the checked-in snapshot or the byte-stability test fails; regenerate only by the file's own documented flow (delete + two scoped runs) and verify by `git diff` that pre-existing entries are byte-identical. Rollback: `git checkout` the snapshot and drop the new tool.
- Review finding 1 (binding correction, lot split): this lane builds lot 1a only (generic + sentropic `api/`); immo binding, F14 wiring and the multi-device browser run move to lot 1b. The within-a-day claim is dropped for the full lot.
- Review finding 2 (binding correction, citations): `actorId` bound from trusted invocation is `mcp-core.ts:229`; the immo seeded revision is `reader-storage.ts:11`. Code comments cite the corrected lines.

## AI Flaky tests
- Acceptance rule: no AI-flaky tests are involved; all tests here are deterministic (memory doubles, fake pool, latency-free).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single cohesive package slice plus thin api binding; one final test cycle)
- Rationale: one port, one tool, one table pair; no parallel sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface in this lane (immo screen is lot 1b); package vitest lanes plus one scoped api unit file on `ENV=test-reader-consent`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create worktree `tmp/worktrees/reader-consent` on branch `feat/reader-consent-persistent` from `origin/main`.
  - [x] Capture Makefile targets (`test-artifacts` SCOPE, `test-api-unit` SCOPE, `scope-check`, `down-volumes`, `commit`).
  - [x] Define environment: `ENV=test-reader-consent` for every make command, ENV last.
  - [x] Confirm scope and guardrails (train rules, review corrections as binding).
  - [x] Validate scope boundaries and declare `RC-EX1`.
- [ ] **Lot 1a — Tests first (acceptance criteria of design-merged lot 1, consent slice)**
  - [ ] `packages/artifacts/tests/reader-consent.test.ts`: store scenarios (grant to find live; revoke to undefined with tombstone at exact revokedAt; duplicate live grant converges; stale scopeVersion ineffective; cross-reader/cross-scope isolation; rollback removes grant plus event; ordering grantedAt then bytewise consentId).
  - [ ] Decision-table suite (design-merged 3.2, all 8 rows): suspended-with-consent refused then auto-resumes; withdrawn share refused, re-share reuses consent; absent consent re-asks; revoked re-asks; stale version re-asks; deleted artifact refused.
  - [ ] `tools/list` hash: pre-existing definitions byte-identical across a profileRevisionId bump; MCP self-revoke works; forged other-principal impossible; admin grant refused; non-reader revoke is `not_found`; double revoke is `changed:false`.
  - [ ] Person purge removes rows plus events; artifact purge leaves zero consent rows.
  - [ ] Sub-lot gate: `make test-artifacts SCOPE=tests/reader-consent.test.ts ENV=test-reader-consent` (unit, no compose stack).
- [ ] **Lot 1b — Implementation (generic package)**
  - [ ] `src/server/consent.ts`: record, scope rules, `consentAllows`, Gate B helper.
  - [ ] `src/server/reader-store.ts`: port, memory double, fail-closed resolver, purge/export.
  - [ ] `src/adapters/postgres-reader-consent.ts` + `sql/reader-consent.sql` (unnumbered body for the train).
  - [ ] Profile append (`contracts.ts`, `radar.ts`, `schemas.ts`, `index.ts`), MCP append (`mcp-core.ts`), HTTP route append (`http.ts`), snapshot growth (RC-EX1).
  - [ ] Sub-lot gate: `make test-artifacts SCOPE=tests/reader-consent.test.ts ENV=test-reader-consent`.
- [ ] **Lot 1c — Implementation (sentropic api binding)**
  - [ ] `api/src/services/artifacts/reader-consent.ts` + `composition.ts` wiring + control-origin routes in `routes/namespaces/artifacts.ts`.
  - [ ] `api/tests/api/artifacts-reader-consent.test.ts` (service-level, memory store).
  - [ ] Sub-lot gate: `make test-api-unit SCOPE=tests/api/artifacts-reader-consent.test.ts ENV=test-reader-consent`.
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck` + `make lint` for touched packages (scoped targets where available).
  - [ ] Retest: `make test-artifacts SCOPE=tests/reader-consent.test.ts ENV=test-reader-consent`, snapshot test file, `make scope-check ENV=test-reader-consent`.
  - [ ] Push branch (no release PR; the wagon joins the train); write `.tmp/rv/reader-consent-lot1.md`.
  - [ ] `make down-volumes ENV=test-reader-consent`.
