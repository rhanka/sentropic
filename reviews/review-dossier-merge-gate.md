# Review dossier — merge gate PR #662 (branch `fix/llm-gateway-muse-vibe-wires`)

```yaml
status: completed
review-author:
  host: muse
  model: muse-spark
  effort: high
target-ref: 993988e1d94c6924e3c983275509759b822fb908
target-diff-sha256: c7fa69a46f0543446da464247188c2d7d1f2ecebdfb1c27a871cf4c20aaf572a
target-scope: packages/llm-mesh/src + packages/llm-gateway/src + api/src (16 files, +391/-80 vs origin/main dc95f7e4f)
legs:
  - path: reviews/leg-merge-correctness.md
    status: completed
  - path: reviews/leg-merge-risk.md
    status: completed
consensus-verdict: REJECT
```

## Reconciliation (coordinator, 2026-10-11)

Both legs agree (majority, must resolve before merge): count_tokens
recognition depends on ready-only inventory (F3/RISK-2) and raw stored
expiry text reaches bodies (F7/RISK-1). Single-leg dispositions, refute-by-default:
- F1 (P1, affinity replacement) — VERIFY then fix: reproduce plan+prepare after auto-drop first.
- F2 (P1, expiry vs auto-refresh) — DEFER: challenges the reconciled spec §15 Gap 1 wording itself (fail-closed reauth-required, host reload owns renewal); implementation is spec-faithful. Follow-up: single-flight renewal before exclusion.
- F4 (committed suppression overwrite) — ACCEPT with regression test.
- F5 (availability rejection masks no-route) — ACCEPT: enrichment keeps frozen refusal on lookup failure.
- F6 (revoked misdescribed as expired) — ACCEPT: expired-at wording only when the expiry predicate holds.
- Comment corrections batch — ACCEPT (doc-only).
- Timestamp presence (RISK-1 remainder): KEEP per reconciled spec §15 (owner-approved); canonicalize to ISO (kills the injection scenario).

## Remediation verification (coordinator, 2026-10-11)

Subagent `gw-remediate` reproduced every accepted finding before fixing
(scratch tests deleted), F2 untouched. Coordinator re-read every src hunk
and re-ran the gates: mesh 611/611 (37 files), gateway 419/419 (32 files),
typecheck+lint clean on both packages. Accepted findings closed; F2 stays
deferred with rationale. Merge unblocked pending green CI on the fix commit.

Deviation (owner-ordered, recorded): h2a MCP identity down all session
(`identity_pending`), so legs run via `tmux <cli>` read-only instead of
`h2a_run` (owner order 2026-10-11). Author host `muse` is outside the
{claude,codex} selector predicate, so strict host-complementarity is
inapplicable; both legs are non-author independent hosts with distinct lenses.
Prior double review (spec §15, `review-dossier-spec15.md`) covered the spec,
not this code delta.

Frozen contracts the legs must hold (spec §15): 401 pre-pool; 404
unknown-model only for non-catalog models; 400 wire-parsed; 429
no-eligible-account overloaded; 503 no-route with joined `; ` diagnostics +
`x-should-retry: false`; 503 + `X-Sentropic-Route-Action` on
reauth/reenrollment diagnostics; count_tokens 401/404/400 with no
lease/metering; no account/lease/credential/secret detail in any body.
