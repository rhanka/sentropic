# BR-73 h2a consumer review

## Reviewer metadata

- Consumer: h2a
- Host: Codex
- Model: `gpt-5.6-sol`
- Effort: `xhigh`
- Reviewer instance: `codex:h2a:63f4db4427b8`
- Target SHA-256: `e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`
- Review envelope: `env:br73-h2a-consumer-review-1786238656325`
- Addendum envelope: `env:br73-h2a-review-addendum-1786238687780`

## Verdict

**APPROVE_WITH_CHANGES**

The mesh control-plane, gateway data-plane and thin-consumer boundary is
approved. The findings below are specification gates before implementation.
No additional owner decision is required when the existing gateway wires are
preserved and cross-account rebinding remains explicit.

## Findings

### F1 — Public policy configuration

- Severity: blocking.
- Add serializable `last-enrolled`, ordered and new-affinity round-robin
  strategies, ordered per-model rules and atomically activated named profiles.
- Round-robin must never move an established affinity.

### F2 — Owner isolation and plan acquisition

- Severity: blocking security/correctness.
- Gateway derives owner scope from verified authentication only.
- Mesh returns opaque, expiring plan/candidate references bound to the owner,
  policy, council and affinity revisions and revalidates them atomically.
- Diagnostic account references are never executable candidate references.

### F3 — Lossless canonical wire

- Severity: blocking functional.
- Preserve system, tools/tool results, images, thinking, stop reasons, usage,
  safe headers, errors and SSE order through capability-aware conversions.
- Fail before commitment when a required capability is not representable.
- Add an executable Codex/OpenAI adapter with a newly enrolled descriptor.

### F4 — Enrollment precedence data

- Severity: major.
- Persist and restore `enrollmentCompletedAt`; expose it only through the
  redacted owner-scoped account-directory port.
- `last-enrolled` precedes priority, weight and load hints by default.

### F5 — Attempt, reservation and cost lifecycle

- Severity: major.
- Define an idempotent attempt lease with one outcome, one optional commitment
  transition and a real release.
- Emit one aggregate financial event per request, including actual or estimated
  consumption from failed pre-commit attempts.
- Hold downstream 2xx status and headers until a valid first frame exists.

### F6 — Affinity state machine

- Severity: major.
- Add audited owner-scoped describe, promote, reset and rebind operations with
  revision/CAS or per-affinity serialization.
- Strict stickiness never changes account automatically; cross-account rebind
  requires opt-in or explicit reset/rebind and reports cache continuity risk.

### F7 — Health classification scope

- Severity: major.
- Adapters report reason, retryability, `retryAfterMs` and route/account/
  transport/provider-model health scope.
- Provider `Retry-After` overrides generic TTL within bounds; use an injected
  clock and test suppression across equivalent models and transports.

### F8 — Consumer credential boundary

- Severity: major.
- h2a stores no provider secret, routing seed, sticky store or catalog.
- It may relay only an opaque short-lived gateway bearer, with explicit expiry,
  revocation, cache and restart-reacquisition semantics.

### F9 — Reproducible delivery

- Severity: major.
- Sentropic supplies commit, versions, tarballs, SHA-256/provenance and gates.
- h2a installs the exact artifacts in an isolated worktree for UAT.
- CD publishes mesh before gateway or waits for the mesh dependency floor.

## Addendum

- Mesh must return an opaque `PreparedRouteAttempt` that executes internally;
  gateway must never receive `SecretAuthMaterial` or an account id.
- New-affinity candidates remain provisional until the first validated stream
  frame/success. Existing affinities never rebind accounts automatically.
- BR-73 must preserve `/v1/messages` and `/v1/chat/completions`; adding
  `/v1/responses` is additive, while replacing Chat Completions needs a new
  owner decision and likely a major version.
- `ModelAlias` and `EquivalenceExclusion` are distinct. Capability requirements
  reuse catalog types. Expiry checks run on every publication CI.

## Reconciliation

All findings above are incorporated into v2 of
`spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`. The later h2a integration/UAT
remains gated on an exact Sentropic candidate; no h2a implementation was
requested or performed during this review.
