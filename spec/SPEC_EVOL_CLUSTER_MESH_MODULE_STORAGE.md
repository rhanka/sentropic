# SPEC_EVOL — Cluster-mesh generic module storage (K1 scope)

## Status

K1 introduced data-pure contract types and validators. The consolidated
branch adds the shared visibility-root runtime and injected Postgres backend.
Spec of record: L3a v4.1 frozen. Frozen comments M1 and
the merged engram L6a identity contract are unchanged and accommodated,
never modified.

## K1 files

- `packages/cluster-mesh/src/storage/contracts.ts`: module/scope/operation
  ids, grant lifetimes, decimal counters, encoded values, work/page limits,
  store incarnation, writer fences.
- `packages/cluster-mesh/src/storage/profiles.ts`: the eleven profile ids
  (§3.1), claims, consumer requirements (§3.2), negotiation helpers.
- `packages/cluster-mesh/src/storage/authority.ts`: scope grants, operation
  checks, revalidation points (§4.3), structural L6a triangle validation.
- `packages/cluster-mesh/src/storage/atomic.ts`: atomic units, chain
  expectations, CAS/allocation rules and distinct replay rules (§5).
- `packages/cluster-mesh/src/storage/staged-units.ts`: staged-unit protocol
  types, canonical fragment binding and sequence/state validators (§7).
- `packages/cluster-mesh/src/storage/readers.ts`: chain cursors, page bounds,
  no-clock-only-expiry rule, leased snapshots (§8).
- `packages/cluster-mesh/src/storage/descriptor.ts`: registered descriptors,
  projection causes, effective-change derivation (§6).
- `packages/cluster-mesh/src/storage/errors.ts`: kernel-to-frozen error
  mapping without invented canonical codes (§15).

## Neutrality

Engram stays neutral: cluster-mesh consumes the L6a triangle structurally
and never imports engram-live. No kernel obligation forces an M1 change.

## K2a follow-up

Test-only in-memory reference plus the atomic, authority, chain and read
corpus in `packages/cluster-mesh/tests/storage/`, with discriminating
mutations recorded in `mutations.spec.ts`.

## Comments transport implementation

C4 uses separately versioned envelopes and preserves all frozen M1 DTOs.
One coherent unit/group is one kernel staged operation. Each incoming
fragment is bounded; its canonical records and derived neutral effects
remain hidden until the kernel root CAS publishes the complete receipt.

Module preparation metadata and kernel fragment acceptance use the same
injected transaction session. The module retains only bounded binding,
frontier, digest-state and acknowledgement metadata. Canonical records,
membership, CAS and publication remain kernel-owned. There is no second
canonical store or migration scheduler.

The declared admissible manifest commits sorted unit identities,
dependencies and payload digests. It attests the supplied inventory, not
undisclosed external-source completeness. Terminal processing compares
measured unit roots/counts before deriving canonical import/unit/batch
receipts and their complete recoverable module result.

Installed module authorization binds the current issued grant, complete
resource tuples, declared domain capabilities and the frozen mapping/source
identity. Final staged publication repeats those checks. A historical
purge outcome remains historical data; current byte disposal is established
only by the operational purge worker.

Export preparation must retain a real kernel root and derive its boundary
from actual membership/heads. Continuations reopen that root under current
scope/resource/availability checks, without a time-based cursor TTL. Only a
verified terminal chain/count constitutes a complete export. Installed and
long-history qualification remains the final delivery gate in BRANCH.md.
