# BR-73 design-review reconciliation

Review target SHA-256:
`e260831daebb04525382b1e10a0030b993cfb5875e06802a421302d04cc02d82`.

Both independent reviewers returned `APPROVE_WITH_CHANGES`. No reviewer asked
for a new owner trade-off: the changes clarified the already accepted ownership
and fallback decisions. The reconciled v2 specification was the implementation
gate.

## Accepted findings

- Account ordering remains in mesh. Enrollment completion is persisted and
  mesh reads owner-scoped eligible descriptors through `AccountDirectoryPort`.
- One-way fallback has owner-scoped describe/promote/reset/rebind operations,
  optimistic revisions, audit events, and cache-risk diagnostics.
- Operational attempt outcomes are separate from the single aggregate gateway
  financial settlement.
- Gateway buffers a valid canonical event before committing a stream and never
  retries after that boundary.
- Provider `Retry-After` overrides the generic negative-cache TTL within the
  validated bounds.
- Bare model ids remain provider-faithful; migrated suffixed aliases are
  canonical mesh aliases, not evidence for broad automatic equivalence.
- Policies support last-enrolled, ordered and new-affinity round-robin
  strategies, first-match rules, and revisioned profiles.
- Plans/candidates are opaque, owner-bound, expiring, and revalidated against
  account, policy, council, and affinity revisions.
- Canonical fixtures cover both existing gateway wires and executable Codex
  and Cloud Code runtimes without moving wire concerns into mesh.
- h2a receives exact package candidates only after Sentropic gates pass and
  performs integration/UAT in its own isolated worktree.

## Rejected or deferred suggestions

- Passing eligible account descriptors in public `RoutePlanInput` was rejected
  because it would let a gateway or consumer forge executable eligibility.
  The accepted `AccountDirectoryPort` gives mesh an owner-scoped internal view.
- No broad cross-family equivalence group ships without pinned benchmark
  evidence. The initial council explicitly excludes every uncovered catalog
  model and therefore fails closed.
- `/v1/responses` remains optional and additive; it does not replace Anthropic
  Messages or OpenAI Chat Completions in this compatible minor evolution.

## Remaining gate

h2a must integrate the exact final Sentropic commit and tarballs, exercise a
real Claude session including compact continuation and logout/re-enrollment,
and return signed evidence before merge.
