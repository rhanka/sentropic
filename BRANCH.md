# Fix(sec): bump vitest 4.0.18 -> 4.1.0 (clear GHSA-5xrq-8626-4rwp) — unblock api-image audit

## Objective
- [x] Clear the CRITICAL vitest advisory `GHSA-5xrq-8626-4rwp` (CVSS 9.8) that reds the api-image npm-audit gate for ALL PRs (found repo-wide by the #526 build-review; inherited from main, not #526's).
- [x] Real fix (not an exception): the only vulnerable vitest in the tree was `4.0.18` (packages/focus, packages/harness, packages/skills). The advisory is fixed in 4.1.0 (4.x) / 3.2.6 (3.x). ui is already 3.2.7, api 4.1.5, 18 packages 4.1.0 — all fixed.

## Scope / Guardrails
- [x] Bump the 3 vulnerable `"vitest": "4.0.18"` devDeps to `"4.1.0"` — the version 18 other packages already run (proven in-repo).
- [x] Regenerate root `package-lock.json` (`make lock-root`): no vitest `4.0.18` remains -> advisory matches nothing -> gate passes with NO exception added.
- [x] No new allowlist entry, no Dockerfile change. Dev-only test tool bump; zero runtime/API change.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/focus/package.json`, `packages/harness/package.json`, `packages/skills/package.json`, `package-lock.json`, `BRANCH.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `api/src/**`, `ui/src/**`, `packages/*/src/**`, `.security/**`
- **Conditional Paths**: none.

## Feedback Loop
- [x] `SEC-VITEST-RCA` — GHSA-5xrq-8626-4rwp affects vitest (arbitrary file read on Windows when the Vitest UI server is exposed to network), fixed in 4.1.0 / 3.2.6. Only `4.0.18` (focus/harness/skills) was vulnerable; the rest of the tree is already >= 4.1.0 / 3.2.7.
- [x] `SEC-VITEST-VERIFY` — `make build-api-image` green: `audit-gate: OK` (api base + production), no vitest advisory remains (only the pre-existing image-size allowlist from #519), api image `Successfully built`.
- [ ] `SEC-VITEST-CI` — PR CI must confirm the focus/harness/skills test suites pass on vitest 4.1.0 (non-breaking) before merge.
- [ ] `SEC-VITEST-SYSTEMIC` — NOTE for a separate follow-up: dev-only tooling (vitest) trips the prod-image `npm audit --omit=dev --workspaces` gate because npm's `--omit=dev` does not exclude workspace devDeps. Future dev-tool advisories will recur; the real hardening is making the gate exclude workspace devDeps (or the wrapper distinguishing dev-only). Out of scope for this urgent unblock.

## AI Flaky tests
- Not applicable: devDependency version bump only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: one atomic security devDep bump; real fix, no exception.

## Plan / Todo (lot-based)
- [x] Lot 0 — RCA: only vitest 4.0.18 (3 packages) vulnerable; 4.1.0 is the repo standard + a fixed version.
- [x] Lot 1 — Bump the 3 pins to 4.1.0; regen root lockfile; confirm no 4.0.18 remains.
- [x] Lot 2 — Verify api-image audit green via `make build-api-image`.
- [ ] Lot 3 — PR CI green (gate + package tests) -> merge -> report api-image audit green on main to conductor.
# Feature: Durable Track owner-signature adapter

## Objective

- [ ] Provide the API-owned durable `TrackOwnerSignaturePort` for the merged `FocusLiveSession` driver.
- [ ] Prove exactly-once owner-signature persistence with a PostgreSQL unique constraint and transactional read-back.

## Scope / Guardrails

- [ ] Scope is limited to the API database schema, one API migration, the durable owner-signature adapter, its Focus live-session composition factory, focused API unit tests, required workspace metadata, and this plan.
- [ ] The durable key is exactly canonical owner issuer, canonical owner subject, workspace, and decision id; idempotency keys remain stored retry metadata only.
- [ ] The adapter persists and reads attestations only; own-principal authentication, trusted relayer provenance, and authorization remain the merged Focus driver’s injected gates.
- [ ] One migration maximum is permitted under `api/drizzle/`.
- [ ] No new HTTP signing route is in scope because no existing API Focus authentication/authorization surface exists to supply the driver’s required gates.
- [ ] All Make commands use `ENV=test-track-sig-adapter` as the final argument; tests never use `ENV=dev`.
- [ ] Owner UAT is required before any live activation or merge.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `api/src/db/schema.ts`
  - `api/src/services/focus/**`
  - `api/tests/unit/track-owner-signature-adapter.test.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/focus/**`
  - `packages/cli/**`
  - `ui/**`
  - `api/src/routes/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (one migration maximum)
  - `.github/workflows/**`
- **Exception process**:
  - [ ] Declare a `BR-SIG-ADAPTER-EXn` item in `## Feedback Loop` before changing a conditional or forbidden path.

## Feedback Loop

- [x] `BR-SIG-ADAPTER-EX1` — approved by the owner’s explicit migration request. `api/drizzle/0041_track_owner_signatures.sql` creates the one durable owner-signature table and unique index; impact is an additive table; rollback is to drop that table in a follow-up migration only after its records are safely retired.
- [x] `BR-SIG-ADAPTER-EX2` — required by the `@sentropic/focus` API workspace dependency. Root and API lockfiles are regenerated through Make; impact is package-resolution metadata only; rollback is to revert each lockfile with its matching manifest.
- [ ] `BR-SIG-ADAPTER-1` — OPEN. No API route currently supplies the Focus driver’s own-principal authentication and authorization dependencies; live endpoint activation remains an owner-gated follow-up after this durable adapter is independently reviewed and UAT-qualified.

## AI Flaky tests

- [ ] Not applicable: deterministic PostgreSQL/Drizzle unit tests only.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- [x] One persistence adapter, composition factory, and real-database proof form one sequential atomic capability.

## UAT Management (in orchestration context)

- [x] No UI or HTTP route is introduced; owner UAT is deferred until a separately authorized authenticated Focus surface is available.
- [ ] Owner verifies the future authenticated Focus surface uses the API composition factory and returns one canonical persisted signature for replayed requests.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Scope and durable persistence decision**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/architecture.md`, and `rules/testing.md`.
  - [x] Run `harness check branch` for `feat/track-durable-signature-adapter`.
  - [x] Inspect the merged Focus live port and test-only in-memory implementation.
  - [x] Inspect the API PostgreSQL/Drizzle schema, migrations, transactional patterns, test conventions, and current Focus wiring.
  - [x] Establish that the API has no current Focus live composition, while PostgreSQL/Drizzle can enforce the required unique key across concurrent writers.
  - [x] Create this plan from `plan/BRANCH_TEMPLATE.md` and commit it before implementation.
  - [x] Lot gate: `harness check scope` and `make scope-check` pass for `BRANCH.md` only.

- [ ] **Lot 1 — Constraint-backed persistence adapter**
  - [ ] Add the owner-signature table schema with all canonical attestation and relayer fields.
  - [ ] Add one additive migration with `UNIQUE(owner_issuer, owner_subject, workspace_id, decision_id)`.
  - [ ] Implement a PostgreSQL/Drizzle `TrackOwnerSignaturePort` using `INSERT … ON CONFLICT DO NOTHING`, a transaction-local canonical read-back, and no application-side check-then-insert path.
  - [ ] Preserve the first persisted attestation and return an authoritative `written` or `duplicate` receipt.
  - [ ] Lot gate: `make typecheck-api ENV=test-track-sig-adapter` and scoped real-adapter unit tests pass.

- [ ] **Lot 2 — API Focus composition and concurrency proof**
  - [ ] Add the API Focus live-session factory that always injects the durable PostgreSQL adapter into `FocusLiveSessionDriver`.
  - [ ] Add `api/tests/unit/track-owner-signature-adapter.test.ts` with real PostgreSQL concurrent appends using distinct idempotency keys and one canonical durable row assertion.
  - [ ] Add persisted canonical attestation read-back coverage.
  - [ ] Add a real database transactional read-back failure test that returns the driver’s honest not-done outcome.
  - [ ] Lot gate: scoped `make test-api-unit SCOPE=tests/unit/track-owner-signature-adapter.test.ts ENV=test-track-sig-adapter` passes.

- [ ] **Lot 3 — Final verification and draft review handoff**
  - [ ] Regenerate API and workspace lock metadata with Make.
  - [ ] Run `make typecheck-api ENV=test-track-sig-adapter` and `make lint-api ENV=test-track-sig-adapter`.
  - [ ] Run the scoped real-adapter tests and the available API unit suite in `ENV=test-track-sig-adapter`.
  - [ ] Run `harness check scope` and `make scope-check` before every commit.
  - [ ] Push `feat/track-durable-signature-adapter` and create a draft PR against `main` from this plan.
  - [ ] State the storage investigation, constraint-backed atomicity, API composition, exact tests, and `draft: independent build-review + owner UAT required before live` in the PR body.
  - [ ] Verify the draft PR CI and record the real commands and outputs.
