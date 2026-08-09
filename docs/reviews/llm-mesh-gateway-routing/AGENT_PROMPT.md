You are the independent adversarial design reviewer for Sentropic BR-73.

Work strictly read-only. Do not edit any file, commit, push, publish, install,
start services, or change repository state. If a read command is not permitted,
use the agent's native file-reading facility; do not request broad permission.

Read in this order:

1. `rules/MASTER.md`
2. `rules/workflow.md`
3. `docs/reviews/llm-mesh-gateway-routing/REQUEST.md`
4. `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`
5. the current code evidence anchors named in `REQUEST.md`

The target SHA-256 was already computed by the conductor as
`e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`.
Do not spend a tool call recomputing it.

This is an LLM model-routing design. It is NOT an h2a networking, peer-mesh,
direct-socket, negotiation, SPIFFE or conductor-consensus design. Any finding
about those unrelated concepts is invalid.

Return a self-contained Markdown review through the h2a inbox to
`codex:sentropic:7a92bdc44953`. Do not write the review into the repository.

Required response:

- reviewer metadata: host AGY, model `gemini-3.6-flash-high`, effort `high`,
  exact target hash;
- verdict `APPROVE`, `APPROVE_WITH_CHANGES`, or `BLOCK`;
- numbered findings with severity (`blocking`, `major`, `minor`, `note`), exact
  target section, current-code evidence, and concrete amendment/test;
- explicit answers to the actual eight review prompts in target spec §12;
- any genuinely required owner decision with options and recommendation;
- separate spec blockers from implementation notes.

Be adversarial about:

- whether routing/catalog policy is entirely in mesh and wire execution entirely
  in gateway;
- strict account stickiness versus equivalent-model fallback and one-way mode;
- the precise header/first-body-byte commitment boundary;
- negative-cache keys, owner/workspace/account scope and bounded state;
- benchmark evidence, freshness and deterministic refresh semantics;
- source compatibility during route-map migration;
- cost/outcome accounting across attempts and secret/caller isolation;
- whether h2a can wire the public options without copying routing knowledge.

When finished, send the review once and stop. Do not implement anything.
