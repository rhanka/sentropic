# Feature: Real Gemini 3.7 Flash Integration

## Objective
- [ ] Add the real `gemini-3.7-flash` profile to `@sentropic/llm-mesh` with verified limits and input modalities.
- [ ] Route agy Cloud Code execution to the real model without resolving through Gemini 3.5 Flash.

## Scope / Guardrails
- [x] Keep implementation under `packages/llm-mesh/**` except the generated-council source exception.
- [x] Use only make targets for build, typecheck, lint, test, and generated artifacts.
- [x] Use `ENV=test-llm-mesh-g37`, always as the last make argument.
- [x] Keep root `ENV=dev` untouched and perform no merge, deploy, publication, or in-branch review.
- [x] Keep each commit under 150 changed lines and stage explicit files only.
- [x] Use owner-supplied verified specifications only; add no unverified capability or GCP variant.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `packages/llm-mesh/**`
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
- [ ] **Conditional Paths**
  - [ ] `BRANCH.md` — owner-mandated branch plan.
  - [ ] `scripts/llm-model-equivalences/council.source.json` — granted under `G37-EX1`.
- [ ] **Exception process**
  - [ ] Declare reason, impact, and rollback before changing a conditional path.

## Feedback Loop
- [x] `G37-EX1` (`acknowledge`, GRANTED) — the owner requires regeneration of the model council instead of manual generated-file edits.
  - [x] Reason: the generator reads its canonical exclusions from `scripts/llm-model-equivalences/council.source.json`.
  - [x] Impact: classify the new Gemini profile as non-equivalent without modifying council policy or generator code.
  - [x] Rollback: remove the new exclusion and regenerate the artifact with the existing make target.
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
- [x] **Lot 0 — Assessment and exact scope**
  - [x] Read `rules/MASTER.md`, workflow, testing rules, and the full ARCH-11 EVOL.
  - [x] Verify branch; confirm existing G1a-G1c, resolver, and the residual outbox carrier on `main`.
  - [x] Gate: `make scope-check ENV=arch11g1a`.

- [x] **Lot 1 — Residual DATA re-key**
  - [x] Add one idempotent control migration for legacy alias rows.
  - [x] Re-key column and embedded tenant/UBO scope copies through `workspaces.tenant_id` only.
  - [x] Commit migration SQL and control journal atomically with this branch plan.
  - [x] Gate: `make db-migrate API_PORT=9055 UI_PORT=5255 MAILDEV_UI_PORT=1155 REGISTRY=local ENV=arch11g1a`.
  - [x] Add focused integration coverage in `api/tests/api/tenancy/arch11-outbox-rekey.test.ts`.
  - [x] Gate: focused test, `make scope-check ENV=arch11g1a`, and `harness check scope`.

- [ ] **Lot 2 — Final validation and delivery**
  - [x] Gate: `make build`, `make typecheck`, and `make lint` with `ENV=arch11g1a` last.
  - [x] Gate: `make test` smoke, unit, endpoints, queue, and security categories are green.
  - [x] Source gap: local AI tests require provider secrets supplied only by `.github/workflows/ci.yml:953-978`.
  - [x] Verify branch scope mechanically and verify no application alias site changed.
  - [ ] Push, open the owner-requested PR without merging, and verify green CI.
  - [ ] Write the report and send valid `sentropic.h2a` envelopes to drumbeat and infra.
