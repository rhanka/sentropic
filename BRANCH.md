# Feature: harness VerificationRun v0 seam (per-check target + artifactLocator + security slot)

## Objective
Add the frozen VerificationRun v0 seam fields (per-check `target`, required `artifactLocator`, reserved `security` category) to `@sentropic/harness`, plus a publishable JSON-Schema, golden fixtures, and a dependency-free runtime validator, per `spec/SPEC_DECISION_SEAM_HARNESS_TRACK_V0.md` (BR-H1).

## Scope / Guardrails
- Scope limited to `packages/harness/**` (artifacts/types/schema/tests) + `BRANCH.md`.
- No migration files (pure-TS tooling package, no DB).
- Make-only workflow, no direct Docker commands.
- harness is tooling-only: NO `make dev`/`make up`, no API/UI/maildev services, no ports.
- Dependency-free: validation is hand-rolled (no ajv); the `make test-harness` toolset is pinned to vitest@4.0.18 / typescript@5.4.5 / @types/node.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/harness/src/artifacts/**`
  - `packages/harness/src/**`
  - `packages/harness/schema/**`
  - `packages/harness/tests/**`
  - `packages/harness/package.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - any other package under `packages/*`
  - any dependency addition (no new entries in `package.json` deps/devDeps)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- none

## AI Flaky tests
- Not applicable (pure-TS tooling package, no AI tests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single orthogonal lot, no concurrent sub-workstreams, no service stack.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface; UAT is the conductor-coordinated contract-snapshot pairing with the track lane (out of this branch's gate).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/workflow.md`, `rules/MASTER.md`, `rules/subagents.md`, `rules/testing.md`, the spec, `packages/harness/README.md`, `verification-run.ts`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/harness-seam-v0` and run development there.
  - [x] Capture Make targets: `make typecheck-harness`, `make test-harness`, `make build-harness`, `make pack-harness`.
  - [x] Confirm no env/ports needed (tooling-only, self-contained docker-run targets).
  - [x] Confirm scope and guardrails; no `BRxx-EXn` needed.

- [x] **Lot 1 — Types: target + artifactLocator + security slot**
  - [x] Add `'security'` to `VerificationCategory`; update the stale "out of this slice" comment.
  - [x] Add `VerificationTarget` interface (`scope?` / `acceptance?`).
  - [x] Add optional `target?` to `VerificationCheck` with the fail-closed doc.
  - [x] Add required `artifactLocator: string` to `VerificationRun` (immutability = producer guarantee).
  - [x] Keep `schemaVersion: 1`.
  - [x] Populate `artifactLocator` in `toVerificationRun` (producer-supplied via context, deterministic default).
  - [x] Lot gate: `make typecheck-harness`

- [x] **Lot 2 — Published JSON-Schema artifact**
  - [x] Author `packages/harness/schema/verification-run.schema.json` (schemaVersion:1, incl. `target`, `artifactLocator`, `security`).
  - [x] Document the frozen `severity` enum + the verdict-derivation predicate as a shared invariant.
  - [x] Add `schema` to `package.json` `files` so it ships (no dependency added).
  - [x] Lot gate: `make pack-harness` (schema present in tarball)

- [x] **Lot 3 — Golden fixtures + dependency-free validator + tests**
  - [x] Typed `.ts` fixtures under `tests/fixtures/verification-run/`: clean / blocking / advisory-only / acceptance-only / dual-target / missing-target.
  - [x] Hand-rolled `validateVerificationRunV0` (structural conformance + fail-closed rules: track-ingested check with no target rejected; unknown enum/category rejected).
  - [x] Document the verdict-derivation predicate in README + schema.
  - [x] Fixture↔schema consistency test (each fixture matches the published schema, dependency-free).
  - [x] Update the two existing exact-shape tests for the new `artifactLocator` field.
  - [x] Lot gate: `make typecheck-harness` + `make test-harness`

- [x] **Lot N — Final validation**
  - [x] `make typecheck-harness`
  - [x] `make test-harness`
  - [x] `make build-harness`
  - [x] `make pack-harness`
  - [x] Bump `packages/harness/package.json` version (minor: additive v0 seam fields).
  - [x] Push branch (PR is the conductor-coordinated joint contract-snapshot pair — NOT opened here).
