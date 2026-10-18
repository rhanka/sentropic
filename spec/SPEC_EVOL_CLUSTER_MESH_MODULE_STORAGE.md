# SPEC_EVOL — Cluster-mesh generic module storage (consolidated K1–K4 / Postgres)

## Status

K1 introduced data-pure contract types and validators. The consolidated
branch adds the shared visibility-root runtime and injected Postgres backend.
Spec of record: L3a v4.1 frozen. Frozen comments M1 and
the merged engram L6a identity contract are unchanged and accommodated,
never modified.

Candidate version is `@sentropic/cluster-mesh@0.19.0`, ordered above npm/main
0.16.0 and PR #679's 0.18.0. The [comments installed proof](../docs/comments-annotations/evidence/installed-module.md)
records exact archive/consumer identities. Source and installed checks do not
substitute for storage co-owner review of the additive port changes.

## Shared root and bounded preparation

The memory `BackendChainState.records` representation is a dense zero-based
sequence: `records.at(i).seq === i`. Restored arrays and indexed histories are
validated at composition. This internal representation does not constrain SQL
physical layout or identify any DAG topological order. A supplied coordinator
must own the exact explicitly supplied backend. Coordinated page operations
validate arguments after grant checks and before returning coverage refusal.

The rebuilt K4 runtime shares K3's actual indexed root with ordinary writes,
transactions, staged units, barriers, journal and purge. Adapters retain
binding identity; durable backend control owns incarnation, issued/revoked
grants, fence epochs, accepted fragments, poison/recovery and original receipts.
There is no adapter-local success store. K3's 56-test validated corpus remains
unchanged and passes.

Preparation advances through bounded record/append/encoded-byte work steps.
Final publication checks current base/head/allocation/coverage and CAS rather
than replaying whole histories. Hidden canonical data and generated receipts
become visible through one root publication. Staged and ordinary writes share
the same scope coordination; a superseded writer cannot stage, seal, publish,
abort or recover writer authority through an old acknowledgement.

Immutable coverage-parent links are indexed and cannot be removed, reparented
or cyclic. Visibility checks use the unit's captured base while parent/cycle
validation uses its evolving prepared root, preserving coherent imported
post-tombstone histories without admitting new writes under committed barriers.
Physical erasure covers active/hidden/snapshot-retained bytes and cleanup;
history claims do not prove that disposal occurred.

## Injected PostgreSQL installation

Public leaves `./storage` and `./storage/postgres` are independent of comments
and database driver evaluation. Hosts inject parameterized execution and
serializable transaction sessions with finite deadlines. The package imports
neither `pg`, `drizzle-orm`, application code nor engram implementation code.

Packaged SQL assets have independent core/module version chains and explicit
dependencies. The host records chronological, ID-keyed receipts under its single
migration lock; local asset order is not a global receipt position. A future core
asset can follow installed comments assets without renumbering either chain.
Installation verifies only asset-owned objects, receipts, constraints,
indexes and functions; runtime startup never creates a second history/scheduler.
Outbox/profile claims follow the configured host binding. Bounded registered
queries and trusted installed operations receive a private same-session SPI;
untrusted inputs supply names/DTOs, never SQL, callbacks or enforcement flags.
Read operations cannot publish canonical effects. Pending operations and nested
bindings reuse the ambient session and its final grant/domain revalidators.

The comments descriptor adds six locally numbered projection/transport/export/
authority/evidence assets; its first asset depends explicitly on core 006.
Installed staged contracts authorize actual
persisted unit facts on every phase; receipt `moduleResult` is owned and retained
with the original publication. All seventeen additive port changes are listed
for gr-conductor in BRANCH.md. SQLite, live-generation replacement and application
cutover retain their separate ownership and qualification.

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

The unit payload commitment streams ordered `[record kind, M1 hash]`
entries; every M1 hash is independently checked against its complete bytes.
Saved digest remainders therefore contain identifiers/hashes, not body text.
Physical comments chain/object addresses hash framed typed identities to
bound storage-key expansion. Canonical record identities and bytes remain
unchanged; operational audit subject IDs use logical typed identities.

Installed module authorization binds the current issued grant, complete
resource tuples, declared domain capabilities and the frozen mapping/source
identity. Final staged publication repeats those checks. A historical
purge outcome remains historical data; current byte disposal is established
only by the operational purge worker.

Export preparation must retain a real kernel root and derive its boundary
from actual membership/heads. Continuations reopen that root under current
scope/resource/availability checks, without a time-based cursor TTL. Only a
verified terminal chain/count constitutes a complete export. Installed and
long-history qualification is recorded in the linked installed evidence; final
CI and co-owner review retain their distinct gates in BRANCH.md.
