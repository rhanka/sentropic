# Feature: Real Gemini 3.7 Flash Integration

## Objective
- [x] Add the real `gemini-3.7-flash` profile to `@sentropic/llm-mesh` with verified limits and input modalities.
- [x] Route agy Cloud Code execution to the real model without resolving through Gemini 3.5 Flash.

## Scope / Guardrails
- [x] Keep implementation under `packages/llm-mesh/**` except owner-required gateway dependency and generated artifact paths.
- [x] Use only make targets for build, typecheck, lint, test, and generated artifacts.
- [x] Use `ENV=test-llm-mesh-g37`, always as the last make argument.
- [x] Keep root `ENV=dev` untouched and perform no merge, deploy, publication, or in-branch review.
- [x] Keep each commit under 150 changed lines and stage explicit files only.
- [x] Use owner-supplied verified specifications only; add no unverified capability or GCP variant.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**
  - [x] `BRANCH.md`
  - [x] `packages/llm-mesh/**`
  - [x] `packages/llm-gateway/package.json` — owner-required workspace consumer dependency correction under `G37-EX5`.
  - [x] `packages/llm-gateway/tests/target.test.ts` — downstream workspace routing assertion under `G37-EX5`.
  - [ ] `scripts/llm-model-equivalences/council.source.json` — owner-required generated-council source under `G37-EX1`.
  - [x] `package-lock.json` — required workspace version synchronization under `G37-EX2`.
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
- [x] `G37-EX5` (`acknowledge`, GRANTED) — the owner requires the sole gateway consumer to use mesh 0.16.0.
  - [x] Reason: the gateway dependency range resolves an obsolete nested registry tarball instead of the workspace package.
  - [x] Impact: raise the gateway mesh dependency floor, regenerate the root lockfile, and align its workspace routing assertion.
  - [x] Rollback: restore the dependency range and regenerate the lockfile together.
- [x] Keep `gemini-3.6-flash` as a compatibility-only capability alias repointed to 3.7; do not advertise it in the default Cloud Code inventory.
- [x] Keep `gemini-3.1-pro` as a compatibility-only capability alias repointed to 3.7; no Claude route may target either legacy alias.
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

- [x] **Lot 3 — PR review fixes**
  - [x] Raise the gateway dependency floor to `@sentropic/llm-mesh@^0.16.0` and regenerate the root lockfile.
  - [x] Prove the gateway lock entry links the workspace and run the real workspace gateway validation.
  - [x] Route every Claude-tier Gemini equivalent directly to `gemini-3.7-flash`.
  - [x] Repoint the retained 3.6 and 3.1 compatibility aliases to the real 3.7 capability source.
  - [x] Add exhaustive Claude-tier candidate and capability-resolution regression coverage.

- [x] **Lot 4 — Final validation and delivery**
  - [x] Run `make build ENV=test-llm-mesh-g37`.
  - [x] Run `make typecheck ENV=test-llm-mesh-g37`.
  - [x] Run `make lint ENV=test-llm-mesh-g37`.
  - [x] Run deterministic `make test ENV=test-llm-mesh-g37` suites; record the isolated live-AI auth failure.
  - [x] Run `make pack-llm-mesh ENV=test-llm-mesh-g37`; leave publication verification to CI.
  - [x] Run `make scope-check ENV=test-llm-mesh-g37` and `harness check scope`.
  - [x] Push `feat/llm-mesh-gemini-37` to the existing PR without merge.
  - [x] Wait for green CI including `enforce-package-bump`, `validate-llm-mesh`, and `validate-llm-gateway`.
  - [x] Write `.tmp/engage/g37-fix-report.md` with assessment first.
  - [x] Deposit a valid `sentropic.h2a` v1.0 report for `claude:sentropic-drumbeat:21fe3355ad7d`.

## Verification Evidence
- [x] `make test-llm-mesh ENV=test-llm-mesh-g37`: 25 files and 145 tests passed after Lot 1.
- [x] `make test-llm-mesh ENV=test-llm-mesh-g37`: 25 files and 147 tests passed after Lot 2.
- [x] `make test-llm-mesh ENV=test-llm-mesh-g37`: 25 files and 148 tests passed after the PR review fixes.
- [x] Gateway workspace validation: typecheck and build passed; 16 files and 111 tests passed against `@sentropic/llm-mesh@0.16.0`.
- [x] `make typecheck-llm-mesh ENV=test-llm-mesh-g37`: passed after Lot 2.
- [x] `make build`, `make typecheck`, and `make lint`: passed in isolated `test-llm-mesh-g37`.
- [x] Aggregate deterministic suites: unit 874 passed / 2 skipped; endpoints 658 passed aside from one parallel ARCH-11 isolation flake that passed scoped and with one worker.
- [x] Targeted public catalog and exhaustive stream contracts: 4 and 94 tests passed respectively.
- [x] `make pack-llm-mesh`: packed `@sentropic/llm-mesh@0.16.0`; council drift and scope gates passed.
- [x] Live-AI aggregate attempted: 18 tests stopped uniformly because all provider auth variables are unset in this worktree.
- [x] PR #540 CI run `31962450752`: success, including both LLM validations and the package-bump gate.
- [x] Record exact commands, results, commit SHAs, PR URL, and CI run in `.tmp/engage/g37-fix-report.md`.
