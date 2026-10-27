---
status: selection-failed
review-author:
  host: codex
  model: gpt-6.1-sol
  effort: high
target-ref: c5d36e740b540627cb5d9266b1808c5586aaee2c
observed-failure: No two eligible complementary host/model pairs with authoritative allocator admission were identified. Live h2a presence advertises hosts and workspace names, not model identity or available quota. No review agents were dispatched.
---

# L8 review handoff

The target is PR798 against feat/live-stt-l2. The author metadata above is the owner's requested
tuple, not an attestation of effective model routing. No independent consensus verdict is claimed.

The required procedure is [harness/review](</home/antoinefa/.codex/plugins/cache/sentropic/h2a/0.98.7/skills/harness/review/SKILL.md>):
“Deduplicate surviving `(profile, model)` pairs and require ≥2.” Repository
[subagent rules](../../../rules/subagents.md) also require owner agreement before agent launches.
The author did not infer extra allocator units from this speech engineering mandate.

Reviewer lenses: transaction/cancellation/replay correctness; aggregate caps, quota attribution and
privacy. Particular checks: the host adapter is absent (G-LEDGER remains open), the fixture does not
prove production durability, provider bounds must be enforced by L9/L13, and metadata never carries
audio/transcript payloads. The existing API ledger sources have not been changed.

Ledger-owner coordination was sent through the signed h2a bus to the live s-conductor instance on
2026-10-27, envelope env:send:a2aaa010-2d5d-444b-9a7f-1de14fb5d355. The concrete handoff requests
one adapter over existing owner tables, with atomic daily/campaign holds and native-unit adjustments;
acceptance requires real database restart, replica concurrency and unavailable-store tests. No
production cloud profile is admitted until that binding and G-CLOUD evidence are accepted.
