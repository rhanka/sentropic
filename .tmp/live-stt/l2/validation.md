# Live STT L2 validation

- Owner-declared author: codex / gpt-6.1-sol / high.
- Approved spec r3 and full L2 row read; base PR757 was 581d6262a at launch.
- Capacity: A Partage normal; no paid API, inference, microphone, model download or Python used.
- Initial red at 4f03beab7: interrupt suite cannot import the absent core/session.js.
- Initial full run: 17/19 pass; remaining failures are exact message-case assertions, corrected.
- Scoped interruption run after implementation: 10/10 pass, including uncertain native start,
  pre-start/double Stop, completion race, native-ID arrival, pending Stop and reconnect.
- Strict source and all test types pass after the final workspace/authentication changes at source 5e51979ba.
- Full final tests: 27/27 pass across all four suites at source 5e51979ba, including CAS restart and immutable typed risk.
- Final lint and build/export/pack pass; package dry-run contains 12 files with all root exports importable.
- All local gates pass: strict source/test types, lint, 27 tests, build/export/pack. Exact-head CI remains pending.
- Earlier default CI runs were cancelled before provider-backed tests began. The owner's r1 instructions
  now require both standard CI and the dedicated Live Speech Core workflow on the delivered head.
  The dedicated gate has no provider secrets; its success alone does not establish global CI success.
- Every local container/test gate uses the shared Docker flock, ENV=test-stt-l2 last and Make cleanup.
  Official gates now clean their qualification network on exit, including failures; no ports published.
- Mechanical branch gate passed before source work; scope gate run before each commit.
- All authored non-merge commits are below 150 changed lines (largest: initial plan replacement, 148).
  Main integration is a real two-parent merge preserving incoming commits; it imports their existing
  changes and is not an atomic new implementation commit. No rebase or cherry-pick used.
- Main integration: origin/main ab981b16d. Containment gate confirms all 346 pre-merge branch events
  and all 370 incoming main events survive. No Track event was hand-edited or repaired.
- Draft PR: https://github.com/rhanka/sentropic/pull/776, base main; never merged.
- Independent review: selection failed, no inferred capacity or consensus; see review.md.
- L3 seam: package root exports coordinator/journal/playback/usage; src/node remains available for the
  profile-selected local STT adapter. This is core fixture readiness, not engine/device qualification.
  Lp0 publication is still required before cross-repo L5 installation.

## PR776 r1 corrections

- Source: ff5990d75e443c66bba458ef200b7c2316b84666; author tuple unchanged.
- P2-1: durable final queue; send is ordered behind prior completion or fence. Restart and lost-ACK
  regressions prove one successor submission, with the old turn still pending.
- P2-2: CAS generation rotation preserves effects, action tombstones and consumed approvals. The
  persisted-byte restart regression retains the mutation barrier and rejects stale generations.
  Unsent finals retain their epoch/submit key when rebound to the new scope.
- P2-3: exact turn/call approval binding; active sibling admissions/results do not invalidate grants.
  Parallel admission and Stop-during-approval regressions cover both progress and fencing.
- P2-4: allocator-admission uniqueness caps counted units at one across operations and persisted replay.
  Receipts verify the coordinator/native-turn link, including delayed native identity recovery.
- Full local run: 34/34 tests pass in all four suites via locked `make test-live-speech ENV=test-stt-l2`.
- The first scoped run was 11/12: the late-native-ID fixture delayed both starts instead of only the
  interrupted one. Changed the mock to apply once; no timeout changes.
- Head CI submitted: https://github.com/rhanka/sentropic/actions/runs/40407144357 and
  https://github.com/rhanka/sentropic/actions/runs/40407144403. Results remain pending at this record.
- Only superseded run 40406605539 was force-cancelled after all its ordinary jobs were already cancelled;
  its remaining queue prevented the requested head run from leaving concurrency pending.
