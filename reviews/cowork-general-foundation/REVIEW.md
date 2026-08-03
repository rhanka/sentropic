---
review-author:
  host: codex
  model: gpt-5.6-terra
  effort: xhigh
target-ref: 670560734c7acf5bed5a86059d7e92352b370273
target-diff-sha256: 2efe8fd4a8da6cc03d2c29d2130dca20849973b8708dff4b27160a33bb7749cb
status: failed
legs:
  - path: reviews/cowork-general-foundation/security.md
    status: failed
  - path: reviews/cowork-general-foundation/protocol.md
    status: failed
---

# Cowork General Lots 1–2 review dossier

Target: `d7ec18180..670560734`.

The two blind legs assess security invariants and protocol/state-machine correctness independently.

## Result

**FAILED — STOP.** Both independent legs found release-blocking violations of
the ratified C3/C4/C5b foundation contract. The implementation remains
fail-closed in the narrow sense that it exposes no input executor or `FAIT`
writer, but it is not an acceptable authority foundation for later lots.
See `security.md` and `protocol.md`; no merge or continuation to Lots 3–8 is
authorized from this state.
