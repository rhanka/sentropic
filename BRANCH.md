# Feature: Live STT L2 interruption core

## Objective
- [x] Deliver approved r3 L2 implementation: durable interruption, all-class dispatch fencing, playback invalidation and usage receipts; final qualification tracked below.

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
  - `.github/workflows/live-speech.yml`
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
- [x] PR776 P2-4: deduplicate counted units by allocator admission ID across operations/restart; limit one unit per estimate and verify the admitted coordinator/native-turn link. Persisted replay and forged-link tests added.
- [x] PR776 P2-3: bind grants to turn/call identity; admissions and active sibling results no longer invalidate parallel approvals. Stop and unresolved-effect transitions still revoke stale grants; concurrency and pending-approval Stop tests added.
- [x] PR776 P2-2: trusted CAS generation rotation carries effects, fences, action tombstones and consumed approvals forward; persisted-byte restart tests retain the mutation barrier and query-only old-turn recovery.
- [x] PR776 P2-1: journal queued finals while a predecessor settles; gate send by prior completion or durable fence, retaining exactly-once submission across restart/lost ACK. Covered in interrupt.test.ts.
- [x] BR757-EX4: default CI selects credentialed live-AI API/E2E suites for Makefile changes, conflicting with zero paid API calls. Cancel only this PR's broad runs before tests start; move deterministic core qualification to a dedicated read-only workflow without provider secrets. Existing global gates stay unchanged. Rollback removes the dedicated workflow; global CI remains explicitly unqualified for this draft.
- [x] Final lint and build/export/pack pass; CI package commands also use the owner-requested ENV=test-stt-l2. Native qualification and publication remain separate.
- [x] Full final package tests pass 27/27 across the four required suites; source includes durable CAS restart and immutable typed-risk verification.
- [x] Add asynchronous authentication input-mutation regression: selected risk/evidence must remain bound to the exact request verified before the await boundary.
- [x] Require the authenticated workspace in the durable scope and operational receipts, alongside tenant/principal/target/source/controller/consent; missing scope fields fail admission.
- [x] Include validate-live-speech in both final CI aggregation dependencies so result capture cannot race this newly selected job.
- [x] Add lost-start-ACK fail-closed admission, inherited class-key refusal and optional native-ID metadata type checks before final quality gates.
- [x] Add concrete CAS-backed SessionJournal tests: persisted-byte restart, transaction rollback and contention retry. Storage durability remains an explicit host primitive; no production in-memory sink is supplied.
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
- [x] **Lot 1 — Tests first**
  - [x] interrupt.test.ts: pre-start Stop, double Stop, late native ID, completion race, all-class fence and restart fixtures authored before source.
  - [x] ordering.test.ts: one commit/submission, pairing/dedupe, stale generations, barrier, partial/stale risk acceptance and fresh authorization fixtures authored first.
  - [x] playback.test.ts: actual rendered samples, stale output, bounded queue and connection/turn epochs authored first.
  - [x] usage-receipts.test.ts: estimate/true-up dedupe, dimensions, restart and payload exclusion authored first.
  - [x] Red at 4f03beab7: scoped interrupt suite fails on missing core/session.js before source implementation.
- [x] **Lot 2 — Implementation**
  - [x] Snapshot command identities and typed risk bodies before asynchronous admission/authentication; opaque proofs stay transient and are never journalled.
  - [x] Durable scopes and receipts require complete authenticated tenant/workspace identity; shared shape validation rejects omitted or extra fields.
  - [x] Uncertain native starts install a tombstone before rethrowing; admission rejects inherited class keys and receipts validate optional identity fields.
  - [x] SessionJournal implements durable snapshot CAS, bounded contention retry, rollback, schema/scope checks and isolated returns over host storage.
  - [x] Fresh mutation approvals bind the barrier revision; denied emitted calls have durable cancelled-before-start results and action tombstones.
  - [x] Expose stopping/pending/terminal separately from fence receipts; retain paired read-only outcomes and suppress Stop RPCs for completed old epochs.
  - [x] All-class admission returns explicit dispatch/dedupe receipts with authority ordering; consumed approval IDs and exact tool/arguments bindings persist across restart.
  - [x] core/session.ts: trusted scoped authority, atomic journal, persisted epochs/tombstones, opaque control port implemented.
  - [x] core/interrupt.ts: all-class fence receipts, outcome pairing, effect barrier and typed authenticated risk acceptance implemented.
  - [x] core/playback.ts: L1-compatible session/stream headers, monotonic rendered samples, bounded transient queue and stale epoch refusal implemented.
  - [x] core/usage-receipts.ts: canonical operation identity, strict metadata fields and signed revision-deduplicated adjustments implemented.
- [x] **Lot 3 — Documentation and local validation**
  - [x] README: control/journal integration, authority and runtime qualification boundaries, L3 integration seam documented.
  - [x] Strict source/test types, lint, build/exports and all 27 package tests pass through locked Make targets; each gate cleans its ENV on exit.
  - [x] make scope-check before every commit; repeatable first-parent atomic-size, whitespace and attribution-trailer audit provided.
  - [x] Review dossier records exact author/source and selection failure without inferred reviewer allocation or consensus; G-REVIEW remains open for merge.
- [ ] **Lot 4 — Draft handoff**
  - [x] Push branch and create draft PR776 to main using this plan as body; implementation plan posted as its first comment.
  - [ ] Obtain green exact-head CI; report PR, head SHA, CI URL and L3 readiness.
  - [x] Keep BRANCH.md and draft; no merge/publication/deployment performed.
