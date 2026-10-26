# Feature: Live STT L2 interruption core

## Objective
- [ ] Deliver approved r3 L2: durable interruption, all-class dispatch fencing, playback invalidation and usage receipts.

## Scope / Guardrails
- [x] Author: codex / gpt-6.1-sol / high. Spec: `.tmp/live-stt/spec-plan.md`, r3, L2 row and sections 4/7.
- [x] Base: origin/feat/live-stt-l1c at 581d6262a3d15e0cedde24b3debe3e3c6413e96b (#757); merge only, never rebase.
- [x] Isolated branch feat/live-stt-l2 in tmp/worktrees/stt-l2; preserve root and other sessions.
- [x] Make-only; ENV=test-stt-l2 last; shared Docker flock for each container/test step, followed by make down.
- [x] No paid API, microphone, inference, audio in logs, Python, publication, deployment or merge.
- [x] Capacity decision: A Partage normal; no extra allocation or qualification units consumed.
- [x] Specific-file staging, make commit only, every commit under 150 changed lines, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/live-speech/**`
  - `.tmp/live-stt/l2/**`
  - `package-lock.json`
  - `packages/cluster-mesh/README.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package*.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - [x] BR757-EX1 below permits only package Make include and dedicated CI gate.

## Feedback Loop
- [x] BR757-EX3: merge origin/main ab981b16d to enable PR776 CI. Preserve L1c 0.23 speech, main peer releases/Decision changes and both README sections. Authored conflict resolutions are small; imported main commits retain their original history. Scope-check at merge measures resolutions against AUTO_MERGE, excluding unchanged incoming commits. Rollback uses the pre-merge parent; never rewrite/rebase.
- [x] Add exact barrier-revision approval binding (including previously unused approvals) and explicit paired cancellation for emitted calls denied before admission.
- [x] Each official live-speech gate now invokes cleanup via Make on exit while still under the shared lock, preserving failures. CI selects this gate only for its package/build/workflow changes.
- [x] Add explicit tests for 2s pending Stop, disconnect/reconnect fencing, completed-epoch late Stop and typed-acceptance replay after durable restart.
- [x] First full core run: 17/19 pass; two ordering assertions expected lowercase substrings while authority errors start Action/Stale. Match the observed identity/revision error messages; no behavior change.
- [x] Playback uses the L1 binary header shape (session/stream identity and negotiated format); add cross-session and independent-stream ordering assertions.
- [x] Admission review adds tests requiring an explicit non-dispatching duplicate receipt, single-use approvals and safe record keys; callers must never infer dispatch permission from an absent result.
- [x] BR757-EX2: register the new dependency-free workspace in root lock metadata so existing npm-ci consumers see the package. Impact limited to its workspace/link entries; rollback removes those entries with the package.
- [x] BR757-EX1: new package has no build/test entrypoint. Add package-local Make recipes using existing qualification Compose service, one root include and CI job. Impact: deterministic isolated package gate; rollback: remove include/job and package recipes. No new containers or ports outside ENV.

## AI Flaky tests
- [x] Deterministic unit fixtures only; no flaky waiver.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; complementary review selected only from evidenced reachable capacity.
- [ ] Multi-branch not required for this single lot.

## UAT Management (in orchestration context)
- [x] Core-only fixture qualification; no device/UI/native-runtime acceptance claimed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read Docker lock first, project rules, approved spec, owner answers and PR757 base.
  - [x] Mechanical harness branch check passes; no service ports required.
  - [x] Add package manifest, strict TS build, Make and CI entrypoints using the existing isolated qualification service.
- [ ] **Lot 1 — Tests first**
  - [x] interrupt.test.ts: pre-start Stop, double Stop, late native ID, completion race, all-class fence and restart fixtures authored before source.
  - [x] ordering.test.ts: one commit/submission, pairing/dedupe, stale generations, barrier, partial/stale risk acceptance and fresh authorization fixtures authored first.
  - [x] playback.test.ts: actual rendered samples, stale output, bounded queue and connection/turn epochs authored first.
  - [x] usage-receipts.test.ts: estimate/true-up dedupe, dimensions, restart and payload exclusion authored first.
  - [x] Red at 4f03beab7: scoped interrupt suite fails on missing core/session.js before source implementation.
- [ ] **Lot 2 — Implementation**
  - [x] Fresh mutation approvals bind the barrier revision; denied emitted calls have durable cancelled-before-start results and action tombstones.
  - [x] Expose stopping/pending/terminal separately from fence receipts; retain paired read-only outcomes and suppress Stop RPCs for completed old epochs.
  - [x] All-class admission returns explicit dispatch/dedupe receipts with authority ordering; consumed approval IDs and exact tool/arguments bindings persist across restart.
  - [x] core/session.ts: trusted scoped authority, atomic journal, persisted epochs/tombstones, opaque control port implemented.
  - [x] core/interrupt.ts: all-class fence receipts, outcome pairing, effect barrier and typed authenticated risk acceptance implemented.
  - [x] core/playback.ts: L1-compatible session/stream headers, monotonic rendered samples, bounded transient queue and stale epoch refusal implemented.
  - [x] core/usage-receipts.ts: canonical operation identity, strict metadata fields and signed revision-deduplicated adjustments implemented.
- [ ] **Lot 3 — Documentation and validation**
  - [x] README: control/journal integration, authority and runtime qualification boundaries, L3 integration seam documented.
  - [ ] Strict source/test types, lint, build/exports and full package tests through locked Make targets.
  - [ ] make scope-check before every commit; atomic-size, whitespace and trailer audit.
  - [ ] Review dossier records exact author/head and independent review outcome without inferred capacity.
- [ ] **Lot 4 — Draft handoff**
  - [ ] Push branch, create draft PR to main using this plan as body; post implementation plan.
  - [ ] Obtain green exact-head CI; report PR, head SHA, CI URL and L3 readiness.
  - [ ] Keep BRANCH.md and draft; do not merge.
