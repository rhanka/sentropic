# Feature: Canvas live H3 validated ingress and real Hocuspocus provider witness

## Objective
- [ ] Deliver approved host plan r3 H3 (`a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7`, lines 116-135, lot table line 49) with offline Hocuspocus-backed host provider harness for DS CL-3 witness 8(i).

## Scope / Guardrails
- [ ] Branch `feat/canvas-live-h3` from `origin/main`; worktree `tmp/worktrees/canvas-h3`.
- [ ] H0 #823, H1 #830, H2 #833 merged (H2 at `d08517ed1`); H1/H2 contracts are the dependency.
- [ ] Make-only, Docker-first, no Python, no user-visible behavior change.
- [ ] `ENV=test-canvas-h3` last; `API_PORT=8802 UI_PORT=5202 MAILDEV_UI_PORT=1102`.
- [ ] Docker operations hold `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; finish with `make down ENV=test-canvas-h3`.
- [ ] No second `CanvasTemplateDescriptor`, collaboration vocabulary, schema generator, or editor code (DS-owned).
- [ ] Atomic commits at most 150 changed lines through `make commit`; selective staging; rebase with `git rebase origin/main` and push only this branch with `--force-with-lease` per COMMON-RULES.
- [ ] Draft PR to main; retain `BRANCH.md`; no merge requested.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/canvas-live/sync-framing.ts`
  - `api/src/services/canvas-live/ingress.ts`
  - `api/src/services/canvas-live/quarantine.ts`
  - `api/src/services/canvas-live/hocuspocus.ts`
  - `api/src/services/canvas-live/harness.ts`
  - `api/src/services/canvas-live/provider.ts`
  - `api/src/services/canvas-live/session-registry.ts`
  - `api/tests/unit/canvas-live-ingress.test.ts`
  - `api/tests/unit/canvas-live-sync-framing.test.ts`
  - `api/tests/unit/canvas-live-quarantine.test.ts`
  - `api/tests/api/canvas-live-hocuspocus.test.ts`
  - `api/tests/api/canvas-live-security.test.ts`
  - `api/tests/api/canvas-live-quarantine-wiring.test.ts`
  - `api/tests/api/canvas-live-composition.test.ts`
  - `api/tests/api/canvas-live-harness.test.ts`
  - `api/tests/helpers/canvas-live.ts`
  - `api/tests/helpers/canvas-live-h3.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `e2e/tests/canvas-live-provider.spec.ts`
  - `docs/canvas-live/h3-validation.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `package.json`
  - `package-lock.json`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/tool-locks.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - [ ] Declare exception ID `BRH3-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - [ ] Include reason, impact, and rollback strategy.
  - [ ] Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] `attention`: H3 dependency closure pin (`yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `y-protocols`) recorded in `docs/canvas-live/h3-validation.md` before claiming conformance — installed, recorded and verified.
- [x] BRLOCK-EX1 carried verbatim from `origin/main` for gate continuity; review r1 CHANGES make H3 exercise lock and Makefile paths: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; authorized Make/CI/container installs and Docker context, tool/consumer runners and locks, packaging probes/manifests, security evidence and regression tests within Allowed Paths; remove on PR closure; rollback by reverting this branch.
- [x] BRH3-EX1 (review r1 item 3): add one `test-canvas-live-harness` target to the forbidden `Makefile` plus a `test:canvas-live-harness` script in `api/package.json`.
  - Reason: the DS witness-8 offline harness must be runnable from a plain checkout; the review requires a committed package entrypoint plus a repo make target, and the harness suite runs through the same `docker compose exec` test infra as every other api suite.
  - Impact: one new make target reusing the existing API_TEST_RUN infra and one package.json script; no existing target, variable or CI stage changes.
  - Rollback: delete the target block and the script line; no other file references them.
- [x] BRH3-COMMIT-SIZE: every commit above 150 changed lines is declared here with its count and rationale (review r2 finding 2; SHAs are post-rebase, counts are insertions+deletions vs parent, pre-rebase SHA from the review in parentheses):
  - `18706953c` (`2cb10a172`) 206 — `api/tests/unit/canvas-live-ingress.test.ts` rewrite (167+/39-): one complete real-Yjs scratch-classification and vector-freshness witness file; splitting publishes a half-written witness suite.
  - `32d397080` (`b921bb3e7`) 175 — `api/tests/api/canvas-live-hocuspocus.test.ts` rewrite (104+/71-): one validated-bridge application and durable-checkpoint witness file; same reason.
  - `857446386` (`0da4f9980`) 164 — `api/tests/api/canvas-live-security.test.ts` rewrite (89+/75-): one hostile-real-bytes refusal and catch-up-replay witness file; same reason.
  - `d88254ac1` (`0b3589d36`) 232 — `api/src/services/canvas-live/ingress.ts` classifier rewire (186+/39-) with its witness vectors (3+/2-) and one `BRANCH.md` line: one cohesive review r1 unit that only compiles, passes and reviews as a whole; splitting publishes a classifier without its validated refusal taxonomy.
  - `f0390d893` (`55dbf09ce`) 201 — `api/src/services/canvas-live/hocuspocus.ts` host rewire (180+/21-): validated bridge, quarantine wiring and admission enforcement form one cohesive unit; splitting publishes a host wired against a classifier API it does not yet exercise.
  - `0d5370f04` (`d99764981`) 167 — `api/src/services/canvas-live/harness.ts` (14+/21-) plus `api/tests/api/canvas-live-harness.test.ts` (132+/0-), the review r1 item 5 replacement: the harness and its DS witness-8 suite are one review-driven unit; splitting publishes an entrypoint without its witness.
  - Init commit `4f1dd96df` (pre-rebase `9fd66cff7`) — 287 changed lines against the old base `1b7f8ab94` (91+/196-), above the rule when review r2 was written; after the rebase onto `2c43d8322` it replaces the 78-line main `BRANCH.md` and stands at 144 changed lines (90+/54-), below the threshold — recorded here to close the review item, no exception needed on this head.
  Reason: each commit is one cohesive review-driven unit — a complete witness file or a classifier/host rewire that only compiles, passes and reviews as a whole; splitting would publish half-written witness suites or a host wired against a classifier API it does not yet exercise. Impact: review reads one complete unit per commit. Rollback: revert the commit.

## AI Flaky tests
- [ ] No AI calls in H3 acceptance; no flaky exceptions requested.

## Orchestration Mode (AI-selected)
- [ ] Mono-branch (single code author; single test cycle; rebase onto `origin/main` for PR updates per COMMON-RULES).
- [ ] Rationale: H3 lots are sequential ingress pipeline steps on one provider surface.

## UAT Management (in orchestration context)
- [ ] Mono-branch: no UI flow change; acceptance uses host service, Hocuspocus witness, and offline harness checks.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, approved host plan r3 H3 section, DS frozen spec `161c5dac` sections 4.11/5.7/8/13.
  - [ ] Confirm worktree `tmp/worktrees/canvas-h3` on `feat/canvas-live-h3` from `origin/main` (`2c43d8322`).
  - [ ] Confirm H1/H2 files (`admission.ts`, `provider.ts`, `session-registry.ts`, `persistence.ts`, `pg-store.ts`, `journal.ts`, `live-document-port.ts`) unchanged from `origin/main`.
  - [ ] Define environment mapping (`ENV=test-canvas-h3`, `API_PORT=8802`, `UI_PORT=5202`, `MAILDEV_UI_PORT=1102`) and Docker lock path.
  - [ ] Confirm command style `make ... ENV=test-canvas-h3` with `ENV` last.
  - [ ] Validate scope boundaries and declare `BRH3-EXn` before any conditional change.
- [x] **Lot 1 — RED witnesses (tests first)**
  - [x] `api/tests/unit/canvas-live-sync-framing.test.ts`: per-frame 1 MiB cap, logical 8 MiB cap, partial frame reassembly without truncation, oversize refusal, MCP 256 KiB cap not applied to sync.
  - [x] `api/tests/unit/canvas-live-ingress.test.ts`: scratch decode, classification, re-authorisation, resulting-schema validation, hostile cases i-vi, reconnect replay vii, stale-vector rule, formatting-span R-LIN-4 acceptance.
  - [x] `api/tests/unit/canvas-live-quarantine.test.ts`: unresolved struct/delete-set quarantine outside authoritative state, actor/admission retention, dependency-arrival revalidation, no-leak to replicas/journal.
  - [x] `api/tests/api/canvas-live-hocuspocus.test.ts`: Hocuspocus-backed provider resolves full `handle.identity`, missing-coordinate failure, wrong field/document/session failure, R-BIND-3 two-fields witness.
  - [x] `api/tests/api/canvas-live-security.test.ts`: hostile content/vector/delete-set unchanged, no applied journal entry, no broadcast, revoked-actor close without applying queued input, repeated-hostile close.
  - [x] Lot gate:
    - [x] RED run fails on missing `sync-framing.ts`, `ingress.ts`, `quarantine.ts`, `hocuspocus.ts`, `harness.ts` before implementation.
- [x] **Lot 2 — Sync framing, ingress pipeline, quarantine**
  - [x] Implement `api/src/services/canvas-live/sync-framing.ts`: bounded reassembly, 1 MiB frame cap, 8 MiB logical cap, no partial apply.
  - [x] Implement `api/src/services/canvas-live/ingress.ts`: isolated-clone decode, shared-type and operation-family classification, current admission re-check, full resulting-schema validation, refusal taxonomy, refusal logging by class, connection-close policy.
  - [x] Implement `api/src/services/canvas-live/quarantine.ts`: pending struct/delete-set store keyed by submitting actor/admission, revalidation on dependency arrival, no journal/broadcast leak.
  - [x] Enforce admission checks at apply time in the validated bridge (`hocuspocus.ts` re-authorises per update through `authorizeUpdate`, registry binding resolution and the classifier admission re-check); preserve viewer/revocation semantics; no DS-owned type published. `provider.ts` and `session-registry.ts` stay unchanged from `origin/main` (review r1 §4).
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-canvas-h3` plus `make lint-api ENV=test-canvas-h3`
    - [ ] **API tests**
      - [ ] `api/tests/unit/canvas-live-ingress.test.ts` GREEN
      - [ ] `api/tests/unit/canvas-live-sync-framing.test.ts` GREEN
      - [ ] `api/tests/unit/canvas-live-quarantine.test.ts` GREEN
      - [ ] `api/tests/helpers/canvas-live.ts` extended only for H3 fixtures
      - [ ] Scoped runs: `make test-api-unit SCOPE=tests/unit/canvas-live-ingress.test.ts ENV=test-canvas-h3`
      - [ ] Sub-lot gate: `make test-api-unit ENV=test-canvas-h3`
- [x] **Lot 3 — Hocuspocus transport adapter plus offline harness**
  - [x] Implement `api/src/services/canvas-live/hocuspocus.ts`: `onAuthenticate` admission, `onLoadDocument` H2 restore, `onStoreDocument` checkpoint, pre-apply update interception, durable journal commit before broadcast, kill/restart recovery.
  - [x] Implement `api/src/services/canvas-live/harness.ts`: offline harness with an explicit `provider` option (`in-memory-double` or `hocuspocus`) echoed in the result, full `handle.identity` resolution and R-BIND-3 two-fields path; the `hocuspocus` path runs a real in-process `@hocuspocus/server` and needs no external network service.
  - [x] Pin and install the dependency closure (`yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `y-protocols` exact versions in `api` devDependencies and both lockfiles); verify installed versions against the workspace install through `api/tests/api/canvas-live-harness.test.ts`; record versions in `docs/canvas-live/h3-validation.md` plus `harness.ts` (production transport wiring lands with H10).
  - [x] Replace the planned e2e provider-switch witness with `api/tests/api/canvas-live-harness.test.ts` (review r1 item 5): DS witness 8 against the in-memory double and the real in-process Hocuspocus server — two fields mounted, one disposed, survivor stays live — plus kill/restart checkpoint replay; delete `e2e/tests/canvas-live-provider.spec.ts`.
  - [ ] Lot gate:
    - [ ] **API tests**
      - [ ] `api/tests/api/canvas-live-hocuspocus.test.ts` GREEN (fake plus Hocuspocus, F2/F6 paths)
      - [ ] `api/tests/api/canvas-live-security.test.ts` GREEN (cases i-vii, real-bytes catch-up replay, legitimate catch-up above 256 KiB)
      - [ ] `api/tests/api/canvas-live-harness.test.ts` GREEN (DS witness 8 against both providers, kill/restart)
      - [ ] Scoped runs: `make test-api-endpoints SCOPE=tests/api/canvas-live-hocuspocus.test.ts ENV=test-canvas-h3`; `make test-canvas-live-harness ENV=test-canvas-h3`
- [ ] **Lot 4 — Docs consolidation and final validation**
  - [x] Write `docs/canvas-live/h3-validation.md`: dependency closure, witness outputs, harness command for DS witness 8(i), no DS-owned export statement.
  - [x] Retest UI: `make test-ui ENV=test-canvas-h3` — 84 files, 497 tests passed.
  - [x] Retest API: `make test-api-unit ENV=test-canvas-h3` (147 files, 1526 passed, 2 skipped) plus scoped H3 api suites `ENV=test-canvas-h3` (47 passed: framing 5, ingress 11, quarantine 4, wiring 3, hocuspocus 7, security 9, composition 4, harness 4; persistence 9); `make typecheck-api` exit 0; `make lint-api` 0 errors.
  - [x] Retest provider-switch witness via `make test-canvas-live-harness ENV=test-canvas-h3` (4 passed; the e2e shell smoke is deleted per review r1 item 5); branch CI e2e groups still run on the exact head for unrelated regressions.
  - [x] `make scope-check ENV=test-canvas-h3` before every commit — PASS C2 on the full branch diff.
  - [ ] Final gate step 1: create draft PR to main using this `BRANCH.md` as body.
  - [ ] Final gate step 2: run and verify branch CI on that PR; resolve blockers; record exact head SHA.
  - [ ] Final gate step 3: `make down ENV=test-canvas-h3` and `make ps` confirm no H3 services.
