# Review dossier — spec §15 (Lot N-1)

```yaml
status: incomplete
observed-failure: both legs failed at launch (h2a MCP identity unavailable); no consensus verdict. Re-dispatch when identity heals.
review-author:
  host: muse
  model: Muse Spark
  effort: unspecified (session default, not attested)
target-ref: spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md @ fix/llm-gateway-muse-vibe-wires (working tree)
target-diff-sha256: b92fa68c194b6477e41d6b75855aef062ae41f0011c84ed9050bdbbd4149882c
legs:
  - path: reviews/leg-1-correctness.md
    status: failed
  - path: reviews/leg-2-contracts.md
    status: failed
```

Target: §15 (§15.1–§15.8, top of §15.4 new this round) — muse/vibe wires,
`count_tokens`, gaps 1–4, no-route diagnostics, subsystem 503 messages,
codex enroll retry, enroll-replace finding, test deltas.
Verify claims against `packages/llm-mesh/src/**` and
`packages/llm-gateway/src/**` in this worktree.
