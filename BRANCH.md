# Feature: Live STT L8 gateway speech and usage

## Objective
- [ ] Bind bounded speech admission, usage and settlement to the gateway ledger owner.

## Scope / Guardrails
- [x] Base origin/feat/live-stt-l2; branch feat/live-stt-l8; worktree tmp/worktrees/stt-l8.
- [x] Spec: .tmp/live-stt/spec-plan.md L8, sections 7/11.2; aggregate USD 5 per UTC day / USD 20 campaign.
- [x] Make-only; ENV=test-stt-l8 last; no containers before 2026-10-27 21:00 UTC; shared flock thereafter.
- [x] Specific-file staging; make commit; under 150 changed lines per commit; no attribution trailers.
- [x] No inference, provider credentials, ledger replacement, native dependencies, publication or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/speech/**`
  - `packages/llm-gateway/tests/speech-*.test.ts`
  - `packages/llm-gateway/tests/fixtures/speech-*.ts`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/llm-gateway/src/index.ts`
  - `package-lock.json`
- **Exception process**:
  - [x] Declare BRL8-EXn with reason, impact and rollback before sensitive changes.

## Feedback Loop
- [ ] G-LEDGER: existing host sink supports monthly text budgets only; ledger owner must supply atomic speech admission and adjustments before cloud activation.
- [x] Docker reservation takes precedence over the container-backed scope target; temporary host Make adapter invokes the same installed harness C2 check before every commit.
- [x] Registry latest is 0.21.3 (2026-10-27); feature version will be 0.22.0, without publication.

## AI Flaky tests
- [x] Deterministic fixtures only; no provider calls or waiver.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential authoring; shared gateway/ledger owner files remain untouched.
- [ ] Multi-branch not required.

## UAT Management (in orchestration context)
- [x] Library contract fixtures only; device/provider qualification belongs to L9/L13/L7.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read Docker lock, project rules, L8 row, M1 receipts and G-LEDGER/G-CLOUD/G-QUOTA.
  - [x] Fetch L2 head 3b793cb89c4a0427152907f986f9415b9c348122 and pass mechanical harness branch check.
  - [x] Inspect existing CostContext, pool/budget admission and durable host ledger; no new accounting store.
  - [x] Reserve ENV=test-stt-l8; package fixtures need no listening ports (reserved API/UI/mail: 9040/5240/1140).
- [ ] **Lot 1 — Typed usage and pricing**
  - [x] src/speech/usage.ts: duration/token/character dimensions, revision normalization and pinned USD pricing.
  - [x] tests/speech-metering.test.ts: cumulative/incremental updates, duplicate/conflicting revisions, absent dimensions and invalid prices.
- [ ] **Lot 2 — Admission binding**
  - [x] Define transaction views over existing owner holds/buckets/allocator receipts; no production store supplied.
  - [x] src/speech/admission.ts: trusted campaign identity, UTC daily and campaign caps, authoritative allocator links, bounded holds and fail-closed host port.
  - [ ] tests/speech-admission.test.ts: daily/total refusal, provider switching, concurrent reservations, restart/replay, allocator identity and ledger outage.
- [ ] **Lot 3 — Settlement binding**
  - [x] src/speech/settlement.ts: one billable operation, conservative missing-usage estimate, signed true-ups, replay and retained uncertainty.
  - [ ] tests/speech-settlement.test.ts: missing usage, adjustment idempotence, restart, unavailable sink and no duplicate backend counted unit.
  - [x] tests/fixtures/speech-ledger.ts: deterministic owner transaction fixture; never exported or used as a production ledger.
- [ ] **Lot 4 — Contract review and integration documentation**
  - [ ] Document ledger-owner binding, dispatch bounds, limitations and G-LEDGER acceptance in README.md.
  - [ ] Export speech subpath and bump package to 0.22.0; keep all shared owner source files unchanged.
  - [ ] Reconcile independent correctness and accounting/security reviews; no self-certification of durable host acceptance.
- [ ] **Lot 5 — Draft delivery and validation**
  - [ ] Push feat/live-stt-l8; open draft PR against feat/live-stt-l2 with this plan as body and post implementation plan.
  - [ ] Monitor exact-head GitHub CI: lint/typecheck/test/build/pack; resolve branch failures.
  - [ ] After 21:00 UTC only: flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make test-llm-gateway ENV=test-stt-l8 once.
  - [ ] Cleanup: flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down ENV=test-stt-l8.
  - [ ] Report draft PR, head, CI and any remaining G-LEDGER owner gate; preserve BRANCH.md, no merge.
