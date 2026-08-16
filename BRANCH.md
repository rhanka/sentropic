# Feature: Real Gemini 3.7 Flash Integration

## Objective
- [x] Add the real `gemini-3.7-flash` profile to `@sentropic/llm-mesh` with verified limits and input modalities.
- [x] Route agy Cloud Code execution to the real model without resolving through Gemini 3.5 Flash.

## Scope / Guardrails
- [x] Keep implementation under `packages/llm-mesh/**` except the generated-council source exception.
- [x] Use only make targets for build, typecheck, lint, test, and generated artifacts.
- [x] Use `ENV=test-llm-mesh-g37`, always as the last make argument.
- [x] Keep root `ENV=dev` untouched and perform no merge, deploy, publication, or in-branch review.
- [x] Keep each commit under 150 changed lines and stage explicit files only.
- [x] Use owner-supplied verified specifications only; add no unverified capability or GCP variant.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `packages/llm-mesh/**`
  - [ ] `scripts/llm-model-equivalences/council.source.json` — owner-required generated-council source under `G37-EX1`.
  - [ ] `package-lock.json` — required workspace version synchronization under `G37-EX2`.
  - [ ] `api/tests/unit/llm-runtime-stream.test.ts` — exhaustive advertised-model stream fixture under `G37-EX3`.
  - [ ] `api/tests/api/models.test.ts` — exact public catalog response under `G37-EX4`.
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
- [ ] **Conditional Paths**
  - [ ] No additional conditional paths.
- [ ] **Exception process**
  - [ ] Declare reason, impact, and rollback before changing a conditional path.

## Feedback Loop
- [x] `G37-EX1` (`acknowledge`, GRANTED) — the owner requires regeneration of the model council instead of manual generated-file edits.
  - [x] Reason: the generator reads its canonical exclusions from `scripts/llm-model-equivalences/council.source.json`.
  - [x] Impact: classify the new Gemini profile as non-equivalent without modifying council policy or generator code.
  - [x] Rollback: remove the new exclusion and regenerate the artifact with the existing make target.
- [x] `G37-EX2` (`acknowledge`, GRANTED) — the owner requires a publishable 0.16.0 workspace package.
  - [x] Reason: root `npm ci` rejects the package bump while the workspace lock still records 0.15.1.
  - [x] Impact: synchronize only the llm-mesh workspace version through `make lock-root`.
  - [x] Rollback: restore the lock entry together with the package version.
- [x] `G37-EX3` (`acknowledge`, GRANTED) — the owner requires green aggregate tests for the advertised model.
  - [x] Reason: the API stream contract rejects any catalog model without a normalization fixture.
  - [x] Impact: add one Gemini 3.7 row to the exhaustive fixture matrix; production API code is unchanged.
  - [x] Rollback: remove the row together with the Gemini 3.7 catalog profile.
- [x] `G37-EX4` (`acknowledge`, GRANTED) — the owner requires Gemini 3.7 in the public model catalog.
  - [x] Reason: the endpoint contract asserts its exact provider/model response and total.
  - [x] Impact: add Gemini 3.7 to the expected Gemini list and increment the expected total only.
  - [x] Rollback: restore both expectations together with the catalog profile.
- [x] Keep `gemini-3.6-flash` as a compatibility-only capability alias repointed to 3.7; do not advertise it in the default Cloud Code inventory.
- [x] Omit `google/gemini-3.7-flash@gcp`; agy uses Cloud Code and no supplied evidence verifies a GCP Model Garden key.
- [x] Skip peer review in this branch because the owner explicitly reserved blind Opus review as a separate activity.

## AI Flaky tests
- [ ] Accept no deterministic failure or additive timeout as flaky.
- [ ] Record eligible provider or network nondeterminism only with same-commit pass evidence and owner sign-off.

## Orchestration Mode
- [x] **Mono-branch**
- [x] Keep all implementation on `feat/llm-mesh-gemini-37` with no subagent or review lane.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Assessment and decisions**
  - [x] Read project rules, package documentation, catalog, providers, routing targets, generated council, account service, and Cloud Code transport.
  - [x] Verify the isolated worktree branch with `harness check branch`.
  - [x] Trace agy from launch aliases through route selection, eligible Cloud Code accounts, runtime client, and the Antigravity wire envelope.
  - [x] Decide direct Gemini profile plus Cloud Code transport; omit the unverified GCP variant.
  - [x] Decide the 3.6 compatibility alias behavior and record it in the delivery report.
  - [x] Run `make scope-check ENV=test-llm-mesh-g37` after defining branch scope.

- [x] **Lot 1 — Real model profile and council coverage**
  - [x] Add `gemini-3.7-flash` to provider lists and the catalog with 1,000,000 input tokens, 65,536 output tokens, and text, image, audio, and video inputs.
  - [x] Add no GCP catalog profile without verified GCP availability.
  - [x] Classify the new profile as non-equivalent and regenerate `generated-model-council.ts` through `make refresh-llm-model-equivalences ENV=test-llm-mesh-g37`.
  - [x] Add facade catalog tests for identity, limits, modalities, and provider capability inheritance.
  - [x] Bump `@sentropic/llm-mesh` from `0.15.1` to `0.16.0`.
  - [x] Gate: `make test-llm-mesh ENV=test-llm-mesh-g37` and `make check-llm-model-equivalences ENV=test-llm-mesh-g37`.

- [x] **Lot 2 — Faithful agy Cloud Code routing**
  - [x] Add the faithful canonical `gemini-3.7-flash` Cloud Code target.
  - [x] Route standard agy candidates and the Cloud Code default to `gemini-3.7-flash`.
  - [x] Replace the default Cloud Code account inventory entry for 3.6 with 3.7.
  - [x] Repoint the 3.6 compatibility capability source from 3.5 to 3.7.
  - [x] Add routing, account inventory, and Cloud Code wire-default tests proving no 3.5 resolution.
  - [x] Gate: `make test-llm-mesh ENV=test-llm-mesh-g37` and `make typecheck-llm-mesh ENV=test-llm-mesh-g37`.

- [ ] **Lot 3 — Final validation and delivery**
  - [ ] Run `make build ENV=test-llm-mesh-g37`.
  - [ ] Run `make typecheck ENV=test-llm-mesh-g37`.
  - [ ] Run `make lint ENV=test-llm-mesh-g37`.
  - [ ] Run `make test ENV=test-llm-mesh-g37`.
  - [ ] Run `make pack-llm-mesh ENV=test-llm-mesh-g37` and the publication dry-run CI gates.
  - [ ] Run `make scope-check ENV=test-llm-mesh-g37` and `harness check scope`.
  - [ ] Push `feat/llm-mesh-gemini-37` without merge and open the requested PR.
  - [ ] Wait for green CI including `enforce-package-bump` and `validate/publish-llm-mesh` dry run.
  - [ ] Write `.tmp/engage/llm-mesh-g37-report.md` with assessment first.
  - [ ] Send valid `sentropic.h2a` v1.0 reports to drumbeat and lane `llm-mesh`.

## Verification Evidence
- [x] `make test-llm-mesh ENV=test-llm-mesh-g37`: 25 files and 145 tests passed after Lot 1.
- [x] `make test-llm-mesh ENV=test-llm-mesh-g37`: 25 files and 147 tests passed after Lot 2.
- [x] `make typecheck-llm-mesh ENV=test-llm-mesh-g37`: passed after Lot 2.
- [ ] Record remaining exact commands, results, commit SHAs, PR URL, and CI run in the delivery report.
