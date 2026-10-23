# Effective profile migration: Radar 0.1.2 and provider 0.1.4 to 0.2.0

Compile an explicit `ArtifactProviderProfile` before building any manifest,
adapter, executor, HTTP app or composition digest. `RADAR_ARTIFACTS_PROFILE`
is explicit four-tool input; the compiler never substitutes it for missing
selection. Empty selection exposes no schema and refuses every dispatch.
Additional known capabilities require explicit operation profiles.

The corrected L0 input uses top-level `selectedCapabilities`; the compiler
returns those capabilities, version, operations and contract revisions at
top level alongside schemas and digest. Omitted `rules` expands to the fixed
v1 C4 semantic rules recorded in the Radar constant; supplied rules remain
explicitly validated. The expanded rules always enter the immutable profile
and digest. This does not supply missing selection, limits or defaults.
Runtime declarations mirror the unpacked `l0-freeze` shapes because that
directory is outside the package's runtime source/build boundary.
Selection errors expose `httpStatus` and `variant: unselected_operation`;
L6 adds invocation correlation when projecting them, without write dispatch.
The trusted authority uses L0's `actorId` and `storageScopeId`; guard and
transaction behavior remain L3/L6 responsibilities.

The compiled object owns immutable selection, schemas, semantic rules,
operation limits/defaults, principal idempotency metadata and integrity digest.
No caller schema override is accepted. The digest covers semantic byte limits
and contract revisions even when generated schema text stays the same.
L6 owns factory/export wiring; L7 owns mesh composition and metadata wiring.

Paths reconcile the inspected 0.1.4 provider and Radar policy: at most **1,024
UTF-8 bytes**, no colon or DEL, and no reserved first segment `api`,
`__artifacts`, `livez`, `health`. Empty/dot/traversal segments, backslash,
percent encoding, query/fragment and C0 controls remain forbidden. Schemas
describe expressible restrictions; shared semantic validation counts bytes.
This does not establish behavior of Radar's uninspected locked 0.1.2 archive.

Keys retain original whitespace and Unicode normalization. Length counts
UTF-16 units; well-formed Unicode is required before UTF-8 conversion.
Lone surrogates are invalid, distinct from the accepted literal U+FFFD.
An optional platform envelope must equal the required tool argument exactly.
Public arguments cannot supply actor, scope, internal key, hash or provenance.
HTTP scope assertions are checked against trusted configuration by L6.

`createRadarKeyDerivation` preserves the existing SHA-256 join algorithm.
The host must supply its actual verified actor domain explicitly as `actorIds`.
Scopes must match `[A-Za-z0-9_-]+`; no trimming or subject-prefix stripping is
performed. Construction rejects actor domains whose delimited prefixes could
alias an ensure/publish tuple. For example, `alice` and `issuer|alice` are
distinct compatible entries, while `alice` and `alice|publish|<UUID>` are
ambiguous and refused. Actors outside the supplied domain are refused.
An incompatible actual domain needs an explicitly versioned migration;
do not substitute guessed Q0 subjects for production qualification.

`createArtifactCommand` snapshots bound scope, normalized payload and forced
`inline-original` provenance. Bytes are owned JSON arrays; object keys sort
recursively in UTF-16 order, including integer-like keys, and file-array order
remains significant. The L0 golden hash body is exactly `operation`,
`scopeBinding` and `payload`, with forced provenance inside `payload`.
The required top-level provenance field mirrors that value outside the hash
body. Caller key, transport,
invocation ID and composition digest are excluded from the command hash.
The separate `artifacts-command/v1` identity leaves manifest digests intact.
Historical durable rows need L6's codec-aware quarantine/migration; this lot
does not reinterpret them or establish cross-process replay durability.

Q0 gaps remain gaps: actual subject-domain qualification, transaction-bound
Radar policy/quota, archived raw logs, installed tuple receipts and restart
qualification are not established by these pure compiler/identity fixtures.
