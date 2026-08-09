# BR-73 design review request

Review target: `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`

Target SHA-256: `e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`

Base: `origin/main` at `feebc6769aac8bd313d84310b1f0d66d07b68ee1`

Review type: independent adversarial architecture and consumer-contract review.
Implementation is blocked until both required reviews are reconciled.

## Author metadata

- Host: Codex
- Model family exposed by the host: GPT-5
- Role: `llm-mesh`
- Decisions: supplied and ratified by the product owner; transcribed into the
  spec by the authoring agent.

No claim is made about an unavailable internal model build identifier or
reasoning-effort label.

## Required reviewers

1. Gemini 3.6 High — architecture, failure-mode and contract adversary.
2. h2a consumer owner/agent — downstream integration and UAT feasibility.

## Review instructions

Read the exact target in full and return:

- verdict: `APPROVE`, `APPROVE_WITH_CHANGES`, or `BLOCK`;
- numbered findings with severity (`blocking`, `major`, `minor`, `note`);
- file section and exact contract affected;
- concrete amendment or test that resolves each finding;
- explicit answers to the eight questions in spec §12;
- any owner decision still genuinely required, with alternatives and a
  recommendation;
- reviewer host/model/effort and the target SHA-256 in the response.

The review is read-only. Do not implement, commit, push, merge, publish or edit
the h2a repository as part of this review.

## Context that must not be lost

- Default is last successfully enrolled first.
- Routing/equivalence policy belongs to mesh, not gateway or h2a.
- Gateway is provider-wire execution and must work for callers in all
  directions, not only Cloud Code.
- Default fallback retests after a configurable negative-cache TTL and prefers
  the same account-transport type; one-way failover is also configurable.
- Strict sticky account is default; equivalent-account rotation is opt-in and
  discouraged because provider cache continuity is unproven.
- Codex re-enrollment is required.
- h2a must wire options and perform exact-candidate local integration/UAT before
  the Sentropic PR merges.
- Both npm packages are bumped; CD publishes only after merge.

## Evidence anchors in current code

- Gateway-owned route tables: `packages/llm-gateway/src/personal-passthrough/target.ts`
- Gateway retry loop: `packages/llm-gateway/src/flow.ts`
- Mesh leases/affinity: `packages/llm-mesh/src/account-transports.ts`
- Gateway owner-scoped coordinator cache:
  `packages/llm-gateway/src/personal-passthrough/pool.ts`
- Codex stateless request: `packages/llm-gateway/src/codex.ts` (`store: false`)
- Mesh catalog: `packages/llm-mesh/src/catalog.ts`

## Review artifacts

- Gemini: `GEMINI_3_6_HIGH.md` (pending)
- h2a: `H2A.md` (pending)
- conductor reconciliation: `RECONCILIATION.md` (pending)
