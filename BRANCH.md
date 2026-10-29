# Feature: Canvas live H1 provider, admission and binding lifetime

## Objective
- [ ] Implement approved host plan r3 H1 behind ports and fakes, with no production activation or visible behavior change.
- [ ] Preserve the owner requirement: humans and authorized AI edit the same block together.

## Scope / Guardrails
- [x] Base: origin/main at H0 merge a3204932e (#823).
- [x] Authority: .tmp/canvas-live/plan-host.md r3, SHA-256 a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7, H1 only.
- [x] Frozen DS specification: 161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834, provider port and binding rules.
- [x] Branch feat/canvas-live-h1; isolated worktree tmp/worktrees/canvas-h1.
- [x] Make only; ENV=test-canvas-h1 last; API_PORT=8800 UI_PORT=5200 MAILDEV_UI_PORT=1100.
- [x] Shared Docker flock per .tmp/packets/DOCKER-LOCK.md; make down after each step; never dev or clean-all.
- [x] Atomic make commit, at most 150 changed lines; no AI trailers; merge never rebase; no Python.
- [x] Production DS imports/type conformance await published CL-1M; real provider/binding qualification remains H3.
- [x] No migrations, editor cutover, persistence implementation, H3 ingress or H4 agent bridge in H1.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/canvas-live/**`
  - `ui/src/lib/adapters/canvas-live/**`
  - `api/tests/unit/canvas-live-*.test.ts`
  - `ui/tests/adapters/canvas-live-*.test.ts`
  - `docs/canvas-live/h1-*.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `packages/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `ui/src/lib/utils/object-lock.ts`
  - `api/src/routes/namespaces/locks-*.ts`
  - `api/src/services/workspace-access.ts`
  - `api/tests/api/locks.test.ts`
  - `api/tests/api/cluster-mesh-locks-cutover.test.ts`
- **Exception process**:
  - [ ] Record BRH1-EXn, reason, impact and rollback before any conditional path change.

## Feedback Loop
- [x] R1 reviews request schema/session refresh, composed revocation, holder-only renewal, explicit object-level L0 granularity and bounded draft recovery lifetime; add RED witnesses before correction.
- [x] Observe three composed-lifetime RED failures; reject cross-kind actor-id reuse and invalidate closed registry admissions/listeners while retaining document resources.
- [x] Observe two L0 RED failures; restrict renewal to current holders and reject unsupported unitRef claims before namespace calls.
- [x] Compose provider resolution, operation authorization, actor subscriptions and admission closure with authoritative checks and registry invalidation.
- [x] Define explicit immutable capture-id reuse refusal, latest-capture recovery, pending-consumption and actor-scoped discard witnesses.
- [x] Observe three draft-lifetime RED failures; implement immutable capture identity, acknowledged pending consumption and explicit discard with compare-and-clear semantics.
- [x] Extend host-close/session-rotation coverage and require stale handles to leave a new session intact; update revoked-resolution refusal expectation.
- [x] Refuse subscriptions to explicitly closed sessions and scope invalidation to the exact session identity.
- [x] Extend actor-kind collision denial to incompatible-schema requests before any draft recovery state can be written.
- [x] Observe the incompatible-schema actor-collision RED; check stored actor kind before schema refusal and distinguish disposed from revoked test expectations.
- [x] CL-1M gate: consume published DS pure types at the adapter boundary when available; preparation shapes are host-local, not a publication/conformance claim.
- [x] H3 gate: actual Y.Doc/Awareness transport factory and production binding/registry-update conformance remain unqualified.
- [x] H2 gate: admission storage is injected; restart witnesses recreate the service over retained records, not a production durable-store claim.
- [x] Track import belongs to the designated conductor; this concurrent author updates BRANCH.md only.

## AI Flaky tests
- [x] No AI-provider tests or flaky waiver planned.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single author; review peers read isolated copies only.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] No visible surface changes; runtime UAT and the 24-mount adoption remain downstream.
- [x] Automated witnesses use only the isolated branch test environment.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read rules, approved plan, H0 receipts, DS provider/schema/binding contracts and namespace seams.
  - [x] Create isolated worktree and pass harness check branch.
  - [x] Record exact environment, ports, scope and deferred publication gates.
- [ ] **Lot 1 — Admission RED witnesses and authority**
  - [x] Join admission and draft recovery with an executable refusal-before-binding witness; pending recovery survives reconnect/service restart.
  - [x] Implement preserved-draft recovery with separate preparation and authenticated actor/draft acknowledgement; original bytes remain immutable.
  - [x] Add api/tests/unit/canvas-live-admission.test.ts; observe behavioral RED before implementation (10 failed assertions at 708de0636).
  - [x] Deny cross-tenant, cross-field, forged actors, viewer edits and revoked admissions; reauthorize each operation.
  - [x] Persist sessionEpoch through restart/reconnect; close/new admission alone rotates it.
  - [x] Refuse schema/profile before binding; preserve draft bytes; require actor/draft acknowledgement for both recovery branches (joined-provider RED observed before implementation).
- [ ] **Lot 2 — Session registry RED witnesses and lifetime**
  - [x] Implement document resource ownership, per-mount leases, field namespaces and explicit actor/awareness update delivery.
  - [x] Define executable registry lifetime, isolation, identity and actor-update witnesses behind the H3 factory port.
  - [x] Add api/tests/unit/canvas-live-provider.test.ts registry cases and observe RED (8 failures at 708de0636; recovery suite 3 failures).
  - [x] Resolve complete identities only; isolate tenants; share one document session and awareness across fields.
  - [x] Refcount mounts, idempotent disposal, release transport on last binding, retain document state.
  - [x] Register actors/awareness explicitly and deliver registry updates, including leave/revocation.
- [ ] **Lot 3 — Provider RED witnesses and adapters**
  - [x] Define executable fake-provider coverage for all lock/presence methods, stream recovery and L0/L2 edit posture.
  - [x] Add ui/tests/adapters/canvas-live-provider.test.ts; observe RED for every lock/presence method and stream recovery (5 assertion failures at 6dd17b1e3).
  - [x] Reuse existing namespace locks/presence ports and object-lock client; no parallel API.
  - [x] Gate controlled L0 editing with locks, keep admitted L2 participants editable together.
- [ ] **Lot 4 — Qualification and handoff**
  - [ ] Pass scoped API/UI suites, typecheck and lint; record commands and RED/GREEN evidence in docs/canvas-live/h1-validation.md.
  - [ ] Reconcile independent consensus review; pass mechanical scope before each commit.
  - [ ] Create draft PR to main using BRANCH.md; post plan and measured validation.
  - [ ] Observe completed/success CI on exact final head; report PR and head without another commit.
  - [ ] Tear down ENV=test-canvas-h1 and leave worktree clean.

## Deferred to H2 / H3 / H10
- [ ] H2 durable storage/journal; H3 real transport and Yjs ingress/binding conformance.
- [ ] Published CL-1M type import/compile witness before production adoption.
- [ ] H10 production activation and single migration of all 24 mounts.
