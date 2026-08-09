# BR-73 Design Review: consumer-neutral LLM routing

## Reviewer metadata

- Host: AGY
- Model: `gemini-3.6-flash-high`
- Effort: `high`
- Target SHA-256: `e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`
- Inbox envelope: `env_rev_gemini_36_high_br73`

## Verdict

**APPROVE_WITH_CHANGES**

The proposed architecture cleanly resolves the ownership split between
`@sentropic/llm-mesh` (control plane: catalog, equivalence, policy, routing and
leases) and `@sentropic/llm-gateway` (data plane: wire adapters, caller authn/z,
execution and response commitment). The reproducible benchmark refresh
mechanism and fallback boundaries are well conceived. Approval is contingent
on resolving the structural findings below before code implementation.

## Findings

### F1 — Account metadata source for routing

- Severity: `major` — spec blocker.
- Target: spec §4.5 and §5.2.
- Evidence: gateway `personal-passthrough/pool.ts` currently owns the
  caller-filtered account snapshot, while mesh `AccountTransportAccount` lacks
  `enrollmentCompletedAt`.
- Finding: the spec does not define how mesh receives eligible redacted account
  descriptors to apply owner decision D1 without receiving secrets or allowing
  gateway to own ordering policy.
- Amendment: add `enrollmentCompletedAt` to `AccountTransportAccount` and add
  redacted eligible account descriptors to `RoutePlanInput`; mesh performs pure
  ranking/filtering over those descriptors.

### F2 — Missing reset for one-way promotion

- Severity: `major` — spec blocker.
- Target: spec D4, §4 and §4.6.
- Evidence: current mesh leases are built/stored in
  `packages/llm-mesh/src/account-transports.ts`, but no public reset exists.
- Finding: `one-way` promotes a fallback until reset, re-enrollment or policy
  change, yet the public contract defines no reset operation.
- Amendment: expose:

  ```ts
  resetAffinityRoute(input: {
    readonly workspaceId?: string;
    readonly ownerUserId: string;
    readonly affinityKey: string;
  }): Promise<boolean>;
  ```

### F3 — Operational outcomes versus financial metering

- Severity: `major` — spec blocker.
- Target: spec §5.2 and §5.4.
- Evidence: current gateway `flow.ts` calls `settle()` per attempt. A failed
  attempt followed by success can therefore settle multiple times.
- Finding: the contract must not conflate per-attempt health/cooldown outcomes
  with financial usage settlement.
- Amendment: define `recordAttemptOutcome()` for each attempt and
  `recordFinancialUsage()` once per request after successful completion or the
  final terminal error, carrying only actual upstream usage.

### F4 — Streaming header commitment

- Severity: `minor` — implementation note.
- Target: spec §5.2 step 6 and §5.3.
- Evidence: current stream flow awaits the first iterator result, but an HTTP
  framework could commit `200` headers before that await resolves.
- Amendment: require streaming adapters to delay client status/headers until
  `firstResult = await iterator.next()` succeeds and yields the first frame.

### F5 — Provider Retry-After precedence

- Severity: `minor` — implementation note.
- Target: spec §4.9.
- Evidence: mesh outcomes already carry `retryAfterMs`.
- Finding: applying the default five-minute negative TTL to a provider-declared
  ten-second cooldown suppresses a route for too long.
- Amendment: a valid provider `retryAfterMs` overrides the configured generic
  negative-cache TTL for that rate-limit entry, subject to safe bounds.

### F6 — Bare ids remain provider-faithful

- Severity: `note` — implementation note.
- Target: spec §4.2.
- Evidence: gateway `LAUNCH_ALIAS_TARGET_MAPPINGS` changes suffixed aliases only.
- Amendment/test: state and test that bare model ids remain provider-faithful
  unless an explicit host council override is supplied.

## Answers to spec §12

1. Policy/catalog leakage: canonical mappings, launch aliases, equivalence,
   capability filtering and alias resolution move into mesh. Gateway retains
   ingress and execution and only re-exports deprecated symbols without a copy.
2. Misplaced wire concerns: none in the proposed boundary. Hono, HTTP/SSE,
   headers, wire error translation and caller authentication stay in gateway.
3. Stickiness/fallback/promotion: strict mode keeps the same account;
   equivalent models may run on that account. Cross-account candidates require
   opt-in and a cache-risk diagnostic. One-way promotion needs the reset in F2.
4. Commitment/retry: only transient pre-commit errors are retryable. Headers
   must be held until the first stream frame; everything after commitment is
   terminal.
5. Council refresh: classification/exclusion plus deterministic pinned offline
   refresh/check is sufficient when implemented as specified.
6. h2a configuration: the public policy/input surface is sufficient; h2a needs
   no embedded target map or alias catalog.
7. Security/cost/cache: opaque account refs and owner filtering protect
   secrets/ownership; F3 is required for cost correctness; rotation must expose
   cache continuity risk.
8. Compatibility: compatible minor releases are plausible if deprecated
   gateway exports are true mesh re-exports for one release.

## Owner decisions proposed by reviewer

1. Account metadata availability:
   - A: add `enrollmentCompletedAt` to mesh account descriptors and pass redacted
     descriptors into mesh planning.
   - B: gateway pre-sorts accounts.
   - Recommendation: A, because ordering policy remains in mesh.
2. Affinity reset:
   - A: expose `resetAffinityRoute` in mesh.
   - B: require re-enrollment.
   - Recommendation: A, for explicit operational control.

Both recommendations are boundary-preserving clarifications of existing owner
decisions and can be reconciled without a new owner trade-off.
