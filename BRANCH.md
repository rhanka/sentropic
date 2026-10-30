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
  - `api/tests/helpers/canvas-live.ts`
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
- [ ] `attention`: H3 dependency closure pin (`yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `y-protocols`) recorded in `docs/canvas-live/h3-validation.md` before claiming conformance.

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
  - [ ] Confirm worktree `tmp/worktrees/canvas-h3` on `feat/canvas-live-h3` from `origin/main` (`8ea119c4d`).
  - [ ] Confirm H1/H2 files (`admission.ts`, `provider.ts`, `session-registry.ts`, `persistence.ts`, `pg-store.ts`, `journal.ts`, `live-document-port.ts`) unchanged from `origin/main`.
  - [ ] Define environment mapping (`ENV=test-canvas-h3`, `API_PORT=8802`, `UI_PORT=5202`, `MAILDEV_UI_PORT=1102`) and Docker lock path.
  - [ ] Confirm command style `make ... ENV=test-canvas-h3` with `ENV` last.
  - [ ] Validate scope boundaries and declare `BRH3-EXn` before any conditional change.
- [ ] **Lot 1 — RED witnesses (tests first)**
  - [ ] `api/tests/unit/canvas-live-sync-framing.test.ts`: per-frame 1 MiB cap, logical 8 MiB cap, partial frame reassembly without truncation, oversize refusal, MCP 256 KiB cap not applied to sync.
  - [ ] `api/tests/unit/canvas-live-ingress.test.ts`: scratch decode, classification, re-authorisation, resulting-schema validation, hostile cases i-vi, reconnect replay vii, stale-vector rule, formatting-span R-LIN-4 acceptance.
  - [ ] `api/tests/unit/canvas-live-quarantine.test.ts`: unresolved struct/delete-set quarantine outside authoritative state, actor/admission retention, dependency-arrival revalidation, no-leak to replicas/journal.
  - [ ] `api/tests/api/canvas-live-hocuspocus.test.ts`: Hocuspocus-backed provider resolves full `handle.identity`, missing-coordinate failure, wrong field/document/session failure, R-BIND-3 two-fields witness.
  - [ ] `api/tests/api/canvas-live-security.test.ts`: hostile content/vector/delete-set unchanged, no applied journal entry, no broadcast, revoked-actor close without applying queued input, repeated-hostile close.
  - [ ] `e2e/tests/canvas-live-provider.spec.ts`: provider switch fake plus Hocuspocus, two fields mounted, one disposed, other stays live.
  - [ ] Lot gate:
    - [ ] RED run fails on missing `sync-framing.ts`, `ingress.ts`, `quarantine.ts`, `hocuspocus.ts`, `harness.ts` before implementation.
- [ ] **Lot 2 — Sync framing, ingress pipeline, quarantine**
  - [ ] Implement `api/src/services/canvas-live/sync-framing.ts`: bounded reassembly, 1 MiB frame cap, 8 MiB logical cap, no partial apply.
  - [ ] Implement `api/src/services/canvas-live/ingress.ts`: isolated-clone decode, shared-type and operation-family classification, current admission re-check, full resulting-schema validation, refusal taxonomy, refusal logging by class, connection-close policy.
  - [ ] Implement `api/src/services/canvas-live/quarantine.ts`: pending struct/delete-set store keyed by submitting actor/admission, revalidation on dependency arrival, no journal/broadcast leak.
  - [ ] Wire `provider.ts` plus `session-registry.ts` admission checks at apply time; preserve viewer/revocation semantics; no DS-owned type published.
  - [ ] Lot gate:
    - [ ] `make typecheck-api ENV=test-canvas-h3` plus `make lint-api ENV=test-canvas-h3`
    - [ ] **API tests**
      - [ ] `api/tests/unit/canvas-live-ingress.test.ts` GREEN
      - [ ] `api/tests/unit/canvas-live-sync-framing.test.ts` GREEN
      - [ ] `api/tests/unit/canvas-live-quarantine.test.ts` GREEN
      - [ ] `api/tests/helpers/canvas-live.ts` extended only for H3 fixtures
      - [ ] Scoped runs: `make test-api-unit SCOPE=tests/unit/canvas-live-ingress.test.ts ENV=test-canvas-h3`
      - [ ] Sub-lot gate: `make test-api-unit ENV=test-canvas-h3`
- [ ] **Lot 3 — Hocuspocus transport adapter plus offline harness**
  - [ ] Implement `api/src/services/canvas-live/hocuspocus.ts`: `onAuthenticate` admission, `onLoadDocument` H2 restore, `onStoreDocument` checkpoint, pre-apply update interception, durable journal commit before broadcast, kill/restart recovery.
  - [ ] Implement `api/src/services/canvas-live/harness.ts`: offline Hocuspocus-backed provider with full `handle.identity` resolution and R-BIND-3 two-fields path, runnable without network.
  - [ ] Pin dependency closure (`yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `y-protocols`) in `api/package.json` plus lockfiles; record versions in `docs/canvas-live/h3-validation.md`.
  - [ ] Add `e2e/tests/canvas-live-provider.spec.ts` provider-switch witness.
  - [ ] Lot gate:
    - [ ] **API tests**
      - [ ] `api/tests/api/canvas-live-hocuspocus.test.ts` GREEN (fake plus Hocuspocus, F2/F6 paths)
      - [ ] `api/tests/api/canvas-live-security.test.ts` GREEN (cases i-vii, reconnect replay, legitimate catch-up above 256 KiB)
      - [ ] Scoped runs: `make test-api-endpoints SCOPE=tests/api/canvas-live-hocuspocus.test.ts ENV=test-canvas-h3`
    - [ ] **E2E tests**
      - [ ] Scoped run: `make test-e2e E2E_SPEC=tests/canvas-live-provider.spec.ts API_PORT=8802 UI_PORT=5202 MAILDEV_UI_PORT=1102 ENV=test-canvas-h3`
- [ ] **Lot 4 — Docs consolidation and final validation**
  - [ ] Write `docs/canvas-live/h3-validation.md`: dependency closure, witness outputs, harness command for DS witness 8(i), no DS-owned export statement.
  - [ ] Retest UI: `make test-ui ENV=test-canvas-h3`.
  - [ ] Retest API: `make test-api ENV=test-canvas-h3`.
  - [ ] Retest E2E group for provider spec plus `make build-api build-ui-image API_PORT=8802 UI_PORT=5202 MAILDEV_UI_PORT=1102 ENV=test-canvas-h3`.
  - [ ] `make scope-check ENV=test-canvas-h3` before every commit.
  - [ ] Final gate step 1: create draft PR to main using this `BRANCH.md` as body.
  - [ ] Final gate step 2: run and verify branch CI on that PR; resolve blockers; record exact head SHA.
  - [ ] Final gate step 3: `make down ENV=test-canvas-h3` and `make ps` confirm no H3 services.
