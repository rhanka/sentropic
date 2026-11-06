# Git binding storage (SG1)

Implements the G0 FROZEN v3 section 2 records for the artifacts 0.2.18 train.
The contract digest is `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba`.
This wagon does not change package versions, frozen tool definitions, locks,
pins or L5. Forge behavior and tool orchestration belong to SG2/SG3; release
finalization and index writes belong to SG4.

## Host composition

The package root exports `GitBinding`, `GitBindingStore`, `GitReleaseIndex`,
`GitReleaseIndexStore`, `GitRepositoryRegistry`, `GitCodeRightsPort`,
`createGitRepositoryRegistry`, `validateGitBindingTarget`, and
`createMemoryGitBindingStore`. The existing `./adapters/postgres` export
provides `createPostgresGitBindingStore` and `createPostgresGitReleaseIndexStore`.
Construction performs no I/O or DDL. The host applies migrations through
`0010_git_bindings.sql` using its migration journal before injecting the ports.

## Migration 0010 rollback

The supported rollback restores the previous application while **retaining the
additive schema**. It does not reverse migration 0010. Before rollback:

1. Stop admission of Git binding mutations, inbound deliveries and publication
   jobs. Drain or fence in-flight work; retain the currently served release.
2. Back up the database and host migration journal. Retain bindings, replay
   receipts, append-only binding events, release-index rows and `releases.git_commit`.
3. Restore the previously qualified application and its non-Git composition,
   without injecting Git ports or running down migrations. Keep 0010 marked
   applied in the host journal; a later upgrade must not replay its DDL.
4. Verify existing release reads and current pointers, then qualify a normal
   non-Git publication and its current-release CAS. Keep Git admission disabled
   until the forward application is restored and its workers are requalified.

The pre-0010 release adapter uses named INSERT columns, tolerates the extra
nullable `git_commit` column and reads releases without consulting Git tables.
`tests/git-bindings-rollback.integration.test.ts` seeds a release before 0010,
applies 0010, retains detached bindings/events and indexed provenance, then
uses those unchanged release methods to read and publish across the rollback
boundary without DDL. It also checks journal/data retention and both immutable
record triggers. This qualifies the package storage path; the deploying host
must still qualify its own restored application, composition and journal.

Schema reversal is unsupported: do not drop tables, columns, indexes, the
`reject_git_record_mutation` function or its dependent triggers, or rewind the
journal. Retained events and index data remain authoritative history. Any future
schema reversal needs a separately qualified export/restore and dependency plan.

## Host projection and registry

`HttpAppDeps.git = { bindings, codeRights }` enables the `artifacts_get.git`
projection after ordinary artifact visibility. Code access is resolved for
the current principal, scope and repository on every read. Page ownership,
page grants, published-source grants and shell roles grant no repository
right. Missing or unavailable rights omit the entire `git` field.
Registry locators and custody references never enter this projection.

Registry entries are scope-bound host configuration. `canWrite` defaults to
false, writable paths to an empty list, and `delegatedPublication` to `none`.
Immo's explicit `personal-only` policy is not a generic default. The host
must call `validateGitBindingTarget` before forge work; unknown repositories,
read-only repositories, refs outside `artifact/`, malformed branch names and
unlisted subpaths are typed refusals. SG3 owns personal identity validation,
automatic-publication policy, owner authorization and executor admission.

## Transactions and replay

`write` is a trusted storage port, not a tool argument surface. SG3 supplies
the invocation's server-resolved actor and effective-command hash, plus a
fully resolved binding and expected record version. `expectedVersion: null`
means initial creation. Every subsequent write uses the current version;
reattach updates the retained detached row and advances its generation.
The store validates transitions, namespace, CAS and generation fences.

Postgres locks the principal-scoped receipt key and parent artifact, then
stores the binding, append-only event and durable replay receipt in one
transaction. Receipts use a SHA-256 key including scope, actor and caller key.
Same-key/same-command replay returns the stored binding; a different command
is refused. Partial unique indexes arbitrate concurrent branch claimants.
The memory double has the same behavior within one process.

No binding mutation deletes a forge branch or changes the served release.
Events contain identifiers and SHAs, never credentials, source or messages.
The optional `live` type is frozen now; SG1 neither persists nor activates
live sessions. GB-live adds its own migration and session lifecycle later.

SG4 writes `releases.git_commit` and exactly one immutable index row per
git-backed release in its release transaction, after job validation and
release CAS. A SHA can have several releases with distinct receipts and
candidates. The read port always filters by storage scope. SG1 never infers
build provenance from caller profile keys or creates release-index rows on
failed builds.

## SQLite decision: named lot SG1-sqlite

Decision: retain the existing SQLite surface and open **SG1-sqlite** for
binding parity. SQLite git-binding support is not delivered or claimed by
SG1. Immo's Postgres acceptance does not depend on this follow-up.

- Owning concern: artifacts storage adapters; conductor assigns the builder
  and imports this lot from `BRANCH.md` into Track as designated writer.
- Delivery bound required by G0: within five calendar days of SG1 exit.
- Resource scope: one additive SQLite migration, one binding/index adapter,
  existing SQLite composition exports, and the shared conformance harness.
  No new dependency, forge implementation, tool definition or release work.
- Verification cost: the existing Docker Node SQLite backend and a serial
  run of the shared suite against SQLite and Postgres; integration owns any
  version/lock changes. Reuse the fixture in `tests/fixtures/git-binding-conformance.ts`.
- Acceptance: lifecycle/audit retention; both active uniqueness constraints;
  scope isolation; namespace refusal; CAS and generation fencing; atomic
  replay/audit rollback; release-index cardinality and immutable rows.
- Exit evidence: backend-specific passing receipts plus a written statement
  of cross-process locking semantics. Existing SQLite conformance still runs
  independently; git remains unavailable there until this lot is accepted.
