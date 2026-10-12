# SPEC_EVOL — Cluster-mesh generic module storage (K1 scope)

## Status

K1 adds data-pure contract types and validators only. No backend, no
runtime, no SQL. Frozen comments M1 and the merged engram L6a identity
contract are unchanged and accommodated, never modified.

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
