# Live STT L2 validation

- Owner-declared author: codex / gpt-6.1-sol / high.
- Approved spec r3 and full L2 row read; base PR757 was 581d6262a at launch.
- Capacity: A Partage normal; no paid API, inference, microphone, model download or Python used.
- Initial red at 4f03beab7: interrupt suite cannot import the absent core/session.js.
- Initial full run: 17/19 pass; remaining failures are exact message-case assertions, corrected.
- Scoped interruption run after implementation: 10/10 pass, including uncertain native start,
  pre-start/double Stop, completion race, native-ID arrival, pending Stop and reconnect.
- Strict source and all test types passed at source 4238b516b; final scope/auth snapshots require rerun.
- Full final tests: 27/27 pass across all four suites at source 5e51979ba, including CAS restart and immutable typed risk.
- Final lint and build/export/pack pass; package dry-run contains 12 files with all root exports importable.
- Final typecheck and exact-head CI: pending execution.
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
