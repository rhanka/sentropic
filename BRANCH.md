# Feature: FocusLiveSession owner-signature gate

## Objective
- [ ] Provide the first live-write primitive for a Track-native decision: an owner-authenticated, authorized, version-pinned, idempotent Track attestation with verified persisted read-back.
- [ ] Return an honest not-done result whenever authentication, authorization, contract validation, ingest, or read-back confirmation is unavailable or fails.

## Scope / Guardrails
- [ ] Scope is limited to the private `@sentropic/focus` live-write driver, its public exports, focused unit tests, package metadata, and this branch plan.
- [ ] The driver accepts only a Track-native decision id; it does not accept, render, transform, or submit an h2a decision dossier.
- [ ] Owner authentication and decision/workspace authorization are required injected gates; a relayer is recorded separately and can never become the attester.
- [ ] The Track ingest contract is pinned to an exact version and every successful write is confirmed by a persisted read-back attestation before success is returned.
- [ ] The package remains private and no package publication, CLI prompt, UI, API endpoint, migration, or Track event-schema change is introduced.
- [ ] The h2a-to-Track dossier adapter, connector teardown, tenancy cache invalidation/freshness repair, durable agentRef repair, and V1 breadth remain held out of scope.
- [ ] Make-only workflow and Docker-first execution apply; every Make command ends with `ENV=focus-sig-gate`.
- [ ] Automated tests use `ENV=test-focus-sig-gate`, never `ENV=dev`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/focus/src/model.ts`
  - `packages/focus/src/live/index.ts`
  - `packages/focus/src/index.ts`
  - `packages/focus/tests/live.spec.ts`
  - `packages/focus/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `packages/cli/**`
  - `packages/focus/src/cli/**`
  - `packages/focus/src/track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `spec/**`
  - `.github/workflows/**`
- **Exception process**:
  - [ ] Declare a `BR-FOCUS-SIG-EXn` item in `## Feedback Loop` with reason, impact, and rollback before changing any conditional or forbidden path.

## Feedback Loop
- [ ] `BR-FOCUS-SIG-GATE-1` — OPEN. Production use remains gated: PR #416 tenancy resolution needs strict mode plus cache invalidation/TTL or fresh per-authorization resolution; this primitive neither claims nor implements that repair.
- [ ] `BR-FOCUS-SIG-GATE-2` — OPEN. The h2a-to-Track dossier adapter/wire is not implemented or consumed; only already Track-native decisions can be submitted.
- [ ] `BR-FOCUS-SIG-GATE-3` — OPEN. No locally installed `@sentropic/track/ingest` contract is yet proven to expose the required owner-attestation event; the driver stays port-injected and returns not-done without a matching pinned implementation.

## AI Flaky tests
- [ ] Not applicable: focused deterministic package unit tests only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- [ ] One coherent package primitive with sequential contract, implementation, and verification lots.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Scope and executable contract plan**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/architecture.md`, and `rules/testing.md`.
  - [x] Run `harness check branch` for `feat/focus-live-signature-gate`.
  - [x] Inspect #503, the FocusSnapshot/Track-read boundary, package metadata, and the plan template.
  - [x] Create this file from `plan/BRANCH_TEMPLATE.md` with allowed and forbidden paths.
  - [ ] Commit the initial plan before implementation.
  - [ ] Lot gate: `harness check scope` and `make scope-check` pass for `BRANCH.md` only.

- [ ] **Lot 1 — Live signature contract and fail-closed driver**
  - [x] Add `FocusLiveSession` types for an own-principal owner act, distinct relayer provenance, Track-native decision target, exact ingest-contract version, idempotency key, duplicate semantics, persisted attestation, and honest not-done outcomes.
  - [x] Add the live driver port that authenticates the owner, authorizes the owner for the requested workspace and decision, rejects an owner/relayer identity substitution, requires the exact pinned Track ingest contract, submits the signature, and reads the attestation back.
  - [x] Export the live driver from the package root without changing the read-only CLI or Track-read binding.
  - [x] Lot gate: package typecheck and focused live-driver test command pass in `ENV=test-focus-sig-gate`.

- [ ] **Lot 2 — Security and duplicate-result test lock**
  - [x] Add `packages/focus/tests/live.spec.ts` covering own-principal authentication required.
  - [x] Add `packages/focus/tests/live.spec.ts` coverage that a relayer cannot forge the owner attestation and that relayer provenance is retained separately.
  - [x] Add `packages/focus/tests/live.spec.ts` coverage that double submit with one idempotency key yields one persisted attestation and a duplicate result.
  - [x] Add `packages/focus/tests/live.spec.ts` coverage that failed or mismatched read-back returns not-done, never a signature.
  - [x] Add `packages/focus/tests/live.spec.ts` coverage that unauthorized workspace or decision is denied before ingest.
  - [ ] Lot gate: focused package tests and package typecheck pass in `ENV=test-focus-sig-gate`.

- [ ] **Lot 3 — Version, final verification, and draft review handoff**
  - [ ] Bump `packages/focus/package.json` from `0.3.0` to the next patch version after checking the published package version.
  - [ ] Run package typecheck, focused live tests, and the available package test suite through Make in `ENV=test-focus-sig-gate`.
  - [ ] Run `harness check scope` and `make scope-check` before every commit.
  - [ ] Create a draft PR against `main` using this plan as the source body; state the contract, held items, and `draft: independent build-review + owner UAT required before merge/live`.
  - [ ] Verify the pushed branch CI and report exact command results, package version, commit SHAs, and PR URL.
