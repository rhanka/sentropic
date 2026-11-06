# A-LIVE tools and retained drafts

This wagon implements AL-T and AL-D from frozen G0 v3 and A-LIVE v2.
The five live definitions are appended after the six G0 definitions, giving
35 catalogue entries. Existing definitions and APP-P1 selection stay stable.
The legacy `artifacts_git_live` entry remains reserved and unselected.

Compose `createLiveService` with a current host authorizer, GitPort,
`createPostgresLiveStore`, a per-binding `LiveKeyPort`, and the qualified
AL-P controller through `LiveWorkerPort`. Bind that service as `HttpAppDeps.live`.
Absent service/worker qualification fails closed. The memory store is a fake.
No worker, key, credential, caller environment or shell is selected by tool input.

The authorizer must resolve the current artifact owner, personal binding,
repository code rights, host write scope, human linkage and GB4 qualification.
Invitations are optional trusted session grants with current code rights;
ordinary artifact reader grants never imply a live invitation. AL-P must
revalidate invitations, generation, code rights and qualification when routing.

`live_status` obtains the dormant revision. `live_write` compares that revision
and the verified head, saves the complete admitted overlay and command result
atomically, then requests worker reconciliation. `appliedRevision` advances
only for an ACK matching session, lease, route epoch and durable revision.
Pending projection is explicit. Read/status never provision a worker.
The controller must stage only admitted GitPort source, never walk worker files.

Read/diff cursors bind scope, artifact, generation, principal, base and revision.
Pages have at most 32 entries and 2 MiB of text. A source change expires an old
cursor instead of mixing snapshots. Status diff pages expose the complete
`files`/`deletes` commit recipe, including mode and content digests.

`git_commit` reconstructs the supplied candidate against the immutable base,
including unchanged binaries, excluded entries, links and modes. It refuses
partial/extra/stale recipes before creating forge objects. Its durable intent
freezes source mutations through forge CAS and reconciliation. Unknown effects
remain `commitState: unknown`; same-key recovery identifies the exact invocation
commit. Postgres atomically updates SG1 head/event, clears the overlay, records
progress and stores the command result. Automatic intent is deferred to AL-I.

Migration `0011_live_drafts.sql` creates a private namespace for metadata,
immutable authenticated ciphertext, command results and hourly commit quotas.
It is independent of publication blobs, manifests and reader grants. No source
arrays are retained in plaintext command receipts. Key custody must provide
per-binding AES-256 data keys, retain old versions until their drafts expire,
encrypt backups, and destroy keys only on an approved purge. Keys and store
credentials must never enter a worker. Old generations remain available through
a separately authorized host recovery/export path using the vault.

The overlay cap is 255 paths / 8 MiB including serialized entry metadata;
one text file is at most 1 MiB. Writes also reserve the full commit budget.
Cap/save failures keep the prior complete revision. Retention is seven days
from an acknowledged mutation or successful explicit restore renewal.
Renewal creates a new authenticated immutable envelope and pointer transaction;
polling and old command replay cannot renew it. Expiry/reset leave tombstones.
`vault.collect` serializes expiry and object collection with renewal, preserving
the winning pointer. Expired text and explicitly reset text are outside retention.

AL-P owns worker provisioning, checkpoints, authenticated serving, automatic
revocation teardown and measured HMR. Its `stop` result must confirm quiescence,
durable checkpoint and complete pod/volume decommissioning. Retained old-session
teardown is fenced to its original generation and reveals only teardown fields.
AL-I/SG4 own clean builds and atomic publication-baseline consumption through
the same scoped transaction port. They must not publish drafts or create a
second pod, build during a dirty-base/divergence conflict, or idle-publish with
`autoPublish: false`. Initial unpublished-branch eligibility must be established
from verified creation history; this service never recreates it on wake/replay.

Immo R1 requires the host-selected live recipe to reproduce the build wrapper's
`VITE_ARTIFACT_MODE=1` / VITE allowlist and scrub GITHUB_PAGES, QA_HARNESS and
API_PROXY_TARGET. R2 requires isolation/proxy enforcement independent of writable
Vite configuration. R3/P7 and OD-SUBSTRATE receipts remain activation gates.
This wagon supplies no production activation or HMR/substrate receipt.
