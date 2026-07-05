---
name: review
description: Use when completing a feature, a design step, or before merging — runs a ≥2-peer consensus review and reconciles the findings, instead of a single rubber-stamp pass.
---

# harness/review

Native sentropic code/design review. Stronger than a single review: **≥2 independent peers**, distinct
lenses, reconciled. Open it with `harness review "<target>" --consensus [--peers <n>]` (records a
WorkEvent).

## Consensus protocol

1. **Dispatch ≥2 independent peers** on the SAME diff/design — ideally different models or angles
   (e.g. Opus 4.8 + Codex 5.5-xhigh), each blind to the others.
2. **Distinct lenses** when a finding can fail in more than one way: correctness · security · performance ·
   does-it-actually-reproduce. Diversity catches what redundancy can't.
3. **Refute by default** — each peer tries to REFUTE the change / a claimed finding. A finding survives
   only if it withstands the skeptics; a kill needs a majority.
4. **Reconcile** — merge findings, surface disagreements explicitly, classify accept / reject / defer with
   a one-line rationale each. Don't average; adjudicate.

## Receiving review (technical rigor, not performative agreement)

Before implementing a suggestion, verify it. If feedback is unclear or technically questionable, push back
with evidence rather than complying blindly. Apply what's correct; refute what's wrong; ask when genuinely
ambiguous.

## Severity & gate

Findings that gate a lot escalate to a `VerificationRun` (`harness verify --category static`). Narrative
findings stay a `WorkEvent`. Blocking findings must be resolved before merge; non-blocking are logged in
`BRANCH.md` `## Feedback Loop` with owner + status.
