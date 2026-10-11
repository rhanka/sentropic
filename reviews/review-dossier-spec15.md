# Review dossier — spec §15 (Lot N-1)

```yaml
status: completed
consensus-verdict: APPROVE_WITH_CHANGES implemented (leg1) + REJECT findings remediated (leg2); no re-review (one-shot tmux sessions) — residual risk carried by CI + UAT gates.
legs:
  - path: reviews/leg-1-correctness.md
    status: completed
  - path: reviews/leg-2-contracts.md
    status: completed
```

## Reconcile (coordinator)

- Leg 1 REJECTs accepted as spec/test fixes: optional `diagnostics` +
  caller-kept first-entry (§15.4); no-planning-side-effects wording (§15.4);
  helper-sharing not parity (§15.8); planner→mapper integration not
  end-to-end (§15.8); per-kind header assertions added (§15.8).
- Leg 1 ACCEPTs kept: transport filtering, admission subject, bodies/headers,
  subsystem messages + LOT2/B3b deviation, retry impl, §15.7 non-normative,
  service + mapper + retry tests.
- Leg 2 sanitization REJECT accepted narrowly: `expiresAt` validated as
  finite date before interpolation; exhaustion detail is code-only when a
  cause code exists (raw message fallback). Gateway verbatim pass-through
  of mesh-authored messages kept: same trust domain, static inventory
  (transport id + ISO date + fixed repair sentence).
- Leg 2 redaction REJECT accepted: secret canary in exhaustion test +
  no-code fallback test; per-kind header freeze in `errors.test.ts`.
- Deferred, not implemented: HTTP-level expiry test (no live HTTP harness
  in scope), immutability/parity tests (overclaim removed instead).

```yaml
review-author:
  host: muse
  model: Muse Spark
  effort: unspecified (session default, not attested)
target-ref: spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md @ fix/llm-gateway-muse-vibe-wires (working tree)
target-diff-sha256: b92fa68c194b6477e41d6b75855aef062ae41f0011c84ed9050bdbbd4149882c
```

Target: §15 (§15.1–§15.8, top of §15.4 new this round) — muse/vibe wires,
`count_tokens`, gaps 1–4, no-route diagnostics, subsystem 503 messages,
codex enroll retry, enroll-replace finding, test deltas.
Verify claims against `packages/llm-mesh/src/**` and
`packages/llm-gateway/src/**` in this worktree.
