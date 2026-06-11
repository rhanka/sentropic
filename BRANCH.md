# BRANCH — chore/arch-14-event-spine-study

- Branch: `chore/arch-14-event-spine-study`
- Mode: mono-branch
- Baseline: origin/main @ 850f9dde3
- Kind: study (doc-only — produces the ARCH-14 output `spec/SPEC_EVOL_EVENT_SPINE.md`)

## Allowed Paths
- [x] `spec/SPEC_EVOL_EVENT_SPINE.md`
- [x] `BRANCH.md`

## Forbidden Paths
- [x] all code (`api/**`, `ui/**`, `packages/**`), `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/drizzle/**`

## Conditional Paths
- [x] none

## Lots
- [x] **Lot 1 — Author ARCH-14 study**
  - [x] Code-reality grounding (10 NOTIFY channels, execution_events, EventEnvelope, BR-44 reaper, OTel) BEFORE drafting
  - [x] Draft `SPEC_EVOL_EVENT_SPINE.md` (outbox + EventBusPort + dispatcher + reconciliation + observability)
  - [x] Double consensus (Codex 5.5-xhigh + Fable 5) — both GO-WITH-CHANGES
  - [x] Reconcile all convergent must-fixes (DD10 grounding fix, trace as internal outbox columns not contract, full outbox DDL + advisory-lock seq, 3-class channel taxonomy, producer write-site reality, audit-vs-prune split, dispatch latency, ARCH-12 gates respected)
- [x] **Lot N — Final**
  - [x] PR (doc-only)

## Feedback Loop
- ARCH-12/D11 gates noted (NOT triggered here): (a) trace/lineage kept as internal outbox columns; (b) transactional comments deferred (comments stays write-then-emit phase-1).
- No owner-irreversible decision (both reviewers confirmed none).

## Deferred
- BR-60 outbox-v0 implementation branch (the buildable lot this study scopes).
- Full OpenTelemetry spans/exporter (observability sub-lot).
- flow-runtime transaction introduction (prerequisite for its outbox co-write).
