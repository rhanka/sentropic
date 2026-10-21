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

### CR-3 — One atomic publication

- Preparation, uploads, checksum verification and manifest sealing MUST remain
  invisible as committed data. One linearization point MUST switch the
  publication unit from its captured predecessor root to the complete successor.
  Public reads by current pointer, historical ID, manifest digest or other
  handles MUST NOT bypass this visibility decision.
- The publication authority MUST durably compare the expected predecessor,
  scope, incarnation and writer epoch/fence, revalidate current rights, and
  publish the manifest/root plus the recoverable receipt as one atomic decision.
  Two writers on the same predecessor MUST NOT both win. A stale writer MUST NOT
  gain authority by rereading a newer head; rebasing needs a new explicit
  preparation decision.
- For SQLite/Postgres first, the authoritative root and durable receipt MUST
  commit in one database transaction. For S3 payload placement, objects are
  prepared first and the same SQL-controlled publication decision makes them
  visible. A provider atomic PUT of one object never commits a collection. An
  optional backend MUST expose exactly one authoritative publication root, never
  independently visible SQL and catalog pointers.
- The logical operation identity, parameter/manifest commitment and original
  receipt MUST survive restart. Concurrent identical retries and retry after a
  lost acknowledgement resolve to one committed effect and the original receipt.
  Reusing an operation identity with different parameters MUST fail. An unknown
  outcome after a possible commit MUST be resolved from durable state, never by
  a blind second publication.
- Failures before the linearization point MUST leave the previous publication
  readable and complete; failures after it MUST leave the successor readable
  and recoverable. Abandoned preparations stay invisible and become eligible
  for bounded, authorized cleanup only after their protection is released.

### CR-4 — Bounded listings and traversal

- Every enumeration (objects, manifests, roots, intents, recovery, graph
  adjacency, GC candidates) MUST expose explicit item and encoded-byte bounds, a
  bounded work/deadline budget and resumable continuation. Limits MUST include
  the full returned envelope and cursor. Oversized single entries MUST fail
  with an explicit limit result, never by defeating the bound.
- The implementation MUST enforce bounds through the backend, never by loading
  all rows/keys and slicing afterward. It MUST NOT accumulate provider pages or
  perform an unbounded global sort. S3 `MaxKeys` alone is not a byte/work
  bound; SQL `LIMIT` alone is not a bound on scanned work. Indexed traversal,
  bounded provider calls and finite transaction/query deadlines back the
  budgets.
- Continuations MUST bind scope, enumeration kind and retained boundary with an
  opaque integrity-protected state or equivalent server-side binding, and MUST
  revalidate current authority on each use. A foreign, malformed,
  stale-incarnation, looping or non-progressing continuation MUST fail or end
  with an explicit incomplete outcome, never report false completion. Key
  material MUST NOT appear in the repository, logs, cursors or qualification
  evidence; rotation MUST invalidate old continuations with an explicit stale
  outcome.
- Publication completeness and ordinary reads MUST follow the committed
  manifest and retained boundary. Backend LIST operations MUST NOT establish
  publication completeness. Reconciliation observes weaker concurrent views and
  MUST document them; it MUST NOT treat LIST absence as deletion authority.
- Bounded work also covers preparation and recovery. A small update MUST NOT
  serialize all historical state. Hot transactional/live paths MUST use
  incremental commitments and indexed access, never whole-history scans.

### CR-5 — Separated rights

- The neutral interface MUST separate **read**, **write/prepare**,
  **publish** and **maintain/delete** authority, scoped to module,
  tenant/workspace and resources. One right MUST NOT silently confer another. A
  public content reader and an administrative storage reader are distinct
  bindings; neither receives storage credentials by implication.
- A writer may prepare objects but MUST NOT publish or delete them without the
  matching grant. A publisher may promote an authorized, verified prepared unit
  but MUST NOT rewrite its bytes. A maintainer may reconcile, retain or purge
  but MUST NOT publish application data. An operation that both writes and
  commits MUST hold explicit write and publish authority through composed
  policy, with final revalidation.
- Rights MUST be checked before data, payload or provider I/O, at each
  continuation, after waits, on retry, at publication and before deletion. The
  entry gate first applies locally decidable checks (missing right, foreign
  scope, expiry, revocation in a host-local revocation set); a local denial
  MUST cause zero storage calls, including control-store SQL. After the gate
  passes, bounded durable authority reads on the control store establish
  current authority before any data/payload access; absence from the local
  revocation set is not proof of durable validity. Revoked or expired grants,
  stale authority/policy revisions, foreign scope and superseded writer epochs
  MUST fail closed. A manifest digest or historical receipt is not an access
  grant.
- Capability types MUST be backed by runtime enforcement. Database handles and
  administrative credentials stay outside untrusted consumer reach (trusted
  broker plus file permissions on SQLite; scoped runtime capabilities with
  least-privilege database/service identities on Postgres/Spanner; scoped IAM
  and bucket permissions on object stores; catalog plus object-store
  restrictions on Iceberg/Neo4j). Combining rights for a trusted host MUST be
  explicit and auditable: the record binds principal, module/scope, composed
  rights, policy/grant revision, operation identity and decision, without
  exposing credentials or grant secrets.
- Listing permission is scoped separately from arbitrary bucket/database
  enumeration; a caller-supplied prefix is not proof of authority. Maintenance
  clients MUST NOT receive the same unrestricted capability as ordinary
  readers/writers. Tests MUST exercise real runtime and deployment
  restrictions, not only TypeScript assignability.

## Common contract shape and compatibility

L00 consolidates documentation. The first code lot, L01a, specifies the
data-only envelope, publication-condition, bounded-page and capability
contracts plus fixed expected vectors; L01b1–L01b4 add the reusable
conformance harness and its test-only reference in separate assertion
families. These lots change no backend. The contract distinguishes
create-or-verify, prepare/seal, publish (expected boundary, operation
identity), committed read, bounded enumerate and authorized collect. It keeps
existing error mappings where applicable and makes conflict, denied,
corrupt/unavailable, limit/incomplete and indeterminate-publication outcomes
distinguishable.

Common-rule conformance is a mandatory versioned baseline in binding and
admission, in addition to the existing eleven functional profiles. It MUST NOT
be advertised as an optional `s3` or `low-frequency` profile in `PROFILE_IDS`.
Baseline admission MUST cover ordinary writes, direct-ID reads and
maintenance, so callers cannot bypass it through a staged/export API. An
offered restore path faces the same admission and incarnation checks, without
requiring restore on backends that do not claim it.

New neutral leaves MUST preserve dependency neutrality: the closed consumer
set gains no database drivers or provider SDKs. Drivers and credentials stay
in host-injected backend leaves. The object bridge depends only on a
structural neutral port; a host injects an artifacts implementation
structurally.

### Qualification-bound admission

The baseline claim digest MUST commit to the common-contract/manifest
versions, adapter identity and version, exact package/code digest, effective
configuration digest, payload and control-store composition, offered surfaces
and functional profiles, and an immutable qualification evidence identifier
plus its report digest. Configuration uses secret references, never secret
values. The referenced record MUST be a successful complete qualification run
for that exact tuple, with the expected test inventory, zero skips/todos and
all required mutant kills. A flag, a self-declaration or a report for another
configuration cannot authorize admission.

The host admission guard MUST resolve the record from its trusted
release/evidence registry, verify its integrity and exact tuple match, and
refuse missing, failing, altered or mismatched evidence. Loss of evidence on
an already activated store makes the binding unavailable; it never enables
legacy fallback.

### One-way store activation and legacy sunset

Activation applies to the entire store incarnation, never to individual
callers or scopes. A durable activation record MUST bind the minimum
contract/store-format version, incarnation, admission claim digests,
profile-parity register digest, validated inventory boundary and activation
fence. For object compositions it also binds the namespace/deny-policy
evidence.

Consumer parity is a precondition: the host MUST inventory all bound consumers
across every scope, including saved bindings, their `CONSUMER_REQUIREMENTS`
claims and required profiles. Activation MUST be refused while any bound
consumer lacks a passing common-contract proof for its required profiles and
installed claim composition on the exact target tuple. Missing, pending, stale
or mismatched proof leaves the store unactivated and usable under its old
contract.

Inventory validation MUST support bounded, resumable pre-validation while old
writers run, with durable progress and receipts bound to incarnation, exact
object versions/digests, retained boundary and validation rules. After the
cutover fence, only the delta since the recorded boundary is validated under
explicit item/byte/work and cutover-deadline budgets; an over-budget delta
aborts without a marker and restores old-contract service. Pre-activation
handles, pending operations and old credentials MUST NOT commit across the
successful activation boundary.

After activation, old-contract write, publish, maintain and collect admission
MUST fail on every scope and path, including saved handles and after restart.
Preexisting bytes enter an activated root only through explicit bounded
verification and sealing under the new envelope; legacy-written units without
that coverage read as unqualified, never as verified success. Rollback after
activation may select only a previously qualified common-compatible
binary/configuration or stop service; it MUST NOT clear the marker or
downgrade the store. L22 deletes the replaced neutral legacy admission and
mutation dispatch paths only after the parity and release conditions below;
a conditional fallback branch is not an acceptable sunset.

### Profile-parity register and release gate (seed)

The register below is seeded from the priority-backend advertisements at the
evidence pin `7c395f43`, then re-read at the consolidation base `6ec93105`.
Every implementation row MUST identify backend/module/configuration, profile
and frozen claim digest, affected consumer claims/bindings, target tuple,
named common and existing K-corpus cases, immutable passing evidence
IDs/digests, status and responsible owner. Status is `pending`,
`requalified` or `withdrawn`; all rows in this draft are **pending**, not
qualification results.

| Profile to account for | Priority backend | Named regression anchors, in addition to the full common corpus |
| --- | --- | --- |
| `atomic-units-v1` | SQLite, Postgres | CT-04/05/06; `atomic-corpus.ts`, `sqlite-corpus.spec.ts`, `postgres-corpus.spec.ts` |
| `immutable-chains-v1` | SQLite, Postgres | CT-01/02/03; `chain-corpus.ts`, `sqlite-corpus.spec.ts`, `postgres-corpus.spec.ts` |
| `immutable-boundaries-v1` | Postgres | CT-02/03/07/08; `read-corpus.ts`, `postgres-manifest.spec.ts` |
| `scope-outbox-v1` | Postgres with resync | CT-04/05/06/07; `root-journal.spec.ts`, `postgres-external-journal.spec.ts` |
| `visibility-barriers-v1` | Postgres | CT-04/09/12; `barrier-corpus.ts`, `postgres-barriers.spec.ts` |
| `staged-units-v1` | Postgres/comments | CT-04/05/06/14; `staged-corpus.ts`, `staged-integrity-corpus.ts`, `postgres-staged.spec.ts` |
| `fenced-writers-v1` | Postgres | CT-04/06/09/14; `authority-corpus.ts`, `postgres-authority.spec.ts` |
| `purge-jobs-v1` | Postgres | CT-10/11-purge/14; `lifecycle-corpus.ts`, `postgres-hidden-purge.spec.ts` |

For configured Postgres/comments bindings, the register MUST expand
`m1-adapter`, `comments-operational`, `comments-c4` and `comments-purge` from
the frozen `CONSUMER_REQUIREMENTS`. A withdrawn advertisement MUST name the
affected consumer claims, the replacement/migration or explicit retirement,
and the artifacts/comments co-owner review; review alone never waives a live
binding proof. Silently deleting a claim or a register row is forbidden. L11
gates on complete priority-backend accounting and passing proofs for every
retained/bound claim; L21 reconciles the register against installed
consumers and exact proposed release tuples. L22 and the final release MUST
wait while any in-scope legacy-only store has consumers that cannot activate;
documenting such claims as pending does not authorize shipping the sunset.
