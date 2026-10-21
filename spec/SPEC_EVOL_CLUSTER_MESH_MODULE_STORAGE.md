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

## Common rule of the neutral storage interface (binding 2026-10-20)

The owner decision of 2026-10-20 ("Règle commune") makes the five low-frequency
S3 storage guarantees a common rule of the neutral interface: immutable objects,
a checksum manifest, one atomic publication, bounded listings and separated
rights. It supersedes the 2026-10-18 study proposal for an additive
low-frequency profile. There is no fourth surface, separate box, S3-only
contract or optional switch.

Cluster-mesh keeps backend-neutral serialization and optimizes the
transactional, analytical and live-graph surfaces. Consumers select a surface and
its requirements, never a driver. SQLite and Postgres are first; Spanner,
Iceberg and Neo4j stay optional implementations. S3/object storage is a
possible placement for data of any surface, not their common control plane.

`MUST` and `MUST NOT` below bind all three surfaces and every backend or
backend composition: SQLite, Postgres, S3/object, and optional Spanner, Iceberg
and Neo4j. A backend may decline a surface it cannot implement; it MUST refuse
that binding rather than advertise partial semantics. Passing the common rule
does not by itself qualify a backend for every surface.

The qualification unit is one exact adapter/version/configuration, its payload
and publication-control stores, and each offered surface. "S3 qualified" means a
tested composition including its authoritative publication mechanism; bucket
connectivity alone is insufficient.

This rule preserves frozen M1/L6a identities and existing L3a payload encodings,
adds an explicitly versioned common contract and envelope, and never silently
reinterprets old hashes, grants, profile claims or persisted bytes. Existing
installations are not retroactively conformant. New-common-contract admission
stays disabled without a matching recorded qualification pass. Activation is a
one-way durable transition for the entire store incarnation across all scopes;
after activation, old-contract write, publish and maintain operations are
refused, including through previously issued bindings.

### Shared meaning across surfaces

| Surface | Immutable publication material | Manifest boundary and one visibility decision |
| --- | --- | --- |
| Transactional | Canonical records, journal segments, immutable record versions, checkpoint chunks | Exact committed transaction/unit or bounded group, predecessor root, ordered journal boundary, receipt |
| Analytical | Immutable file batches, columnar chunks, versioned table metadata | One complete selected batch/table snapshot: schema, partitions, source boundary |
| Live graph | Immutable fact/event versions, projection-generation deltas or snapshots | One coherent fact/projection generation and its source watermark |

"Object" is an addressable immutable logical payload/version, including a SQL
row version or graph fact version. Mutable indexes, coordination rows and
current-root pointers MUST NOT change the meaning or bytes of an already
published object identity. Corrections create successors; erasure follows the
authorized lifecycle path only.

One publication unit has one authority domain and scope. Surfaces exposing that
unit MUST derive visibility from its committed root. Independently published
derived views MUST state their own source boundary and MUST NOT claim an atomic
cross-surface update.

### CR-1 — Immutable objects

- Payload and manifest objects under an immutable identity are create-only. The
  adapter MUST enforce this at the concurrency boundary (conditional create,
  uniqueness plus transactional comparison, or an equivalent qualified
  primitive). Checking absence then writing unconditionally is insufficient.
- An identical-byte retry under the same identity MUST be idempotent. A
  different-byte retry MUST fail without modifying the first object. The adapter
  MUST verify the SHA-256 and byte length; an existing key, identifier, ETag or
  success status alone is not proof of equality.
- Accepted input bytes MUST be owned or otherwise protected against caller
  mutation until verification completes. Dedupe MUST NOT let a caller discover
  or access another scope's object.
- Retained roots, active readers, pending intents and holds MUST protect their
  objects from concurrent collection. Collection MUST serialize its deletion
  claim with reference/pin creation and coordinate the external delete with that
  claim. Reference, pin and deletion identities bind store incarnation, module,
  scope and object version/digest; one scope's release MUST NOT remove another
  scope's protection.
- Immutability is not indefinite retention and does not require a purge service,
  verified physical erasure or restore replay unless the binding claims the
  `purge-jobs-v1` / `restore-witness-v1` profiles. An unclaimed lifecycle
  operation MUST be explicitly refused.

### CR-2 — A versioned checksum manifest

- Every visible publication unit MUST be bound to an immutable, versioned
  manifest and its SHA-256 commitment. The transitive commitment MUST cover the
  complete declared publication inventory; an unbound external list is
  insufficient. Manifests may reference immutable pages and previously verified
  roots for incremental commits.
- The envelope MUST bind at least: common-contract and manifest versions;
  module and tenant/workspace scope; surface; store incarnation; publication
  identity and expected predecessor/root version; source boundary;
  schema/descriptor and encoding versions; ordered unit/root commitments where
  order matters; object identifiers/locators, byte lengths and SHA-256 digests;
  and an explicit terminal count/completeness commitment. The manifest digest is
  computed over the canonical body without its own digest field. An unknown
  version MUST be refused before interpreting ordering or applying any
  version-specific canonicalization.
- Source-boundary values have surface-specific meaning: journal/head positions
  (transactional), batch/table snapshot and partition selection (analytical),
  fact/projection generation plus source watermark (live graph). A checksum
  receipt proves the supplied inventory, not the completeness of an undisclosed
  upstream source.
- Canonicalization MUST preserve existing L3a record bytes and the ordered
  `unitRoots` commitment. The new envelope wraps the existing export manifest or
  commits its canonical bytes and digest; it MUST NOT feed order-sensitive
  structures through an array-sorting codec. No existing digest is migrated by
  silently recomputing it with another codec.
- Before publication, every newly referenced payload MUST complete bounded
  verification of its exact encoded bytes, length and digest. Readers MUST
  validate manifest and payload commitments before exposing a payload as
  verified; a missing, truncated, corrupt, wrong-scope or unsupported-version
  object MUST fail closed.
- A partial export or missing terminal marker MUST NOT qualify as a complete
  manifest or successful publication. Manifests and their pages obey the CR-4
  bounds. SQL atomicity and provider checksums do not replace this
  interface-level inventory commitment.
