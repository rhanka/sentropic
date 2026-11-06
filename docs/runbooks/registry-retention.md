# Registry retention proposal

This proposal travels on `chore/registry-retention` into the next dated release train, with no wagon PR.
Automation implementation and activation require a subsequent train implementation.
Baseline: `origin/main` at `165ce5b932206bcd89e6374f5b80d970cd1d19b6`.

Restrict inventory and deletion to Scaleway namespace `nc-reg`, repositories named `sentropic-*`.
Recommend a dedicated daily scheduled workflow with manual dispatch and dry-run as the default.
This gives retention its own permissions and failure reporting, independently of publication success.
A serialized post-publish job is an alternative if it provides all protections below.

The retained set is the union of:

- The newest **N tags per repository**, ordered by registry creation time; default `N=10`, configurable only to values of at least 10. Retain all ties at the boundary.
- All tags created on/after the fixed cutoff, or within the future grace period; include them before computing digest closure.
- Every image reference in Deployments, StatefulSets, Jobs, CronJobs, retained ReplicaSets and DaemonSets in `sentropic-preprod` and `sentropic`.
- Regular, init and ephemeral containers from every workload pod template, including CronJob job templates.
- Every Pod image and status `imageID` in those namespaces, including regular, init and ephemeral containers.
- Every image overlay and explicit pin on freshly resolved `origin/main`.
- Explicit recovery pins: API `f2313a` and UI `434fe5`.
- Current candidate pins computed from the baseline: API `ff9bb4`, UI `2d6476` and E2E `572d74`; all three were verified absent during this cleanup.
- Additional configured protected pins, removed only by an explicit reviewed change; age never expires them.

Required references are live workload/Pod images, active `deploy/k8s/**` and `deploy/ci/**` manifest pins,
recovery pins and configured persistent pins. Require complete, non-empty workload/Pod reads in both
namespaces. Each required reference must resolve to an existing digest, and each tag to its UUID.
Explicitly exclude test fixtures and examples when selecting active deployment manifests.

Computed candidates (`API_VERSION`, `UI_VERSION`, `E2E_VERSION`, `API_TOOL_VERSION`) and historical
citations outside active deployment manifests are conditional: protect if present. Mark them
`verified-absent` only after a complete authenticated, paginated inventory proves absence, or an
authenticated manifest request returns a recognized registry 404. Missing publication is possible
when CI filters skip publication. Protect candidates of active main and release-train heads too.
Transport/authentication errors, partial pagination and ambiguous abbreviated matches always abort.
Resolve abbreviated identifiers uniquely to exact repository, tag UUID and digest before applying.
Protect desired workload references and observed running digests independently.
Production specifications using `:main` currently coexist with older running digests; both must survive.
Resolve image indexes recursively and protect actual platform child digests.
Compute closure per repository over index/manifest digests, recursive platform/attestation child
manifests and image config digests. If a protected tree intersects another tree at one of these
digests, protect that tree and its tag aliases; repeat until no protection changes.
Apply this to every protection reason, including newest-N, age and pins, as well as running images.
Normalize runtime scheme prefixes in Pod imageIDs; unmatched required runtime/config digests or
unresolvable protected children abort deletion. Shared layer blobs alone do not connect image trees.

For the fixed cleanup, a tag is eligible only when it is outside the retained set and was created
strictly before `2026-10-01T00:00:00Z`.
For future automation, replace that fixed cutoff with a **30-day grace period**:
only tags created strictly before the run's UTC timestamp minus 30 days may become eligible.
Missing or ambiguous timestamps, digests or required pin resolutions fail closed.

Execution contract for the implementing train:

1. Acquire an exclusion mechanism shared by retention, every publisher, and deployment/rollback paths.
   Workflow concurrency alone is insufficient unless every competing writer participates.
   Keep mutation disabled until this coordination is verified.
   Refuse mutation while image build/publish/deploy workflow runs or operator cutover jobs are queued
   or in progress. Include canonical content-hash reuse: an old tag can become a new candidate
   without a push or a change to its original registry creation timestamp.
2. Read a complete, freshly paginated registry inventory: repository, tag, UUID, creation time,
   reported size and digest; resolve the manifest/index graph.
3. Read all required Kubernetes resources and resolve current `origin/main` pins.
   Missing access, partial responses or unresolved required references stop deletion.
4. Compute protection reasons and eligible tag UUIDs. Dry-run reports the proposed actions only.
   An explicit apply mode is required for mutation.
5. Before each deletion batch, refresh workload and Pod references, pins, and candidate identities.
   Require each candidate's UUID and digest to match the reviewed inventory.
   Any changed protection input or tag identity invalidates the batch; recompute before continuing.
   Use batches of at most 20 tags and revalidate each UUID/digest immediately before deletion.
   Reassert namespace `nc-reg` and repository prefix `sentropic-` on every delete call.
6. Delete individual tag UUIDs only through the already-used Scaleway `scw` operation or API.
   Never delete by digest, image, repository or namespace; stop on an unexpected response.
7. Relist tags after mutation and verify protected tags, indexes and child manifests remain available.
   Record confirmed deletions and incomplete batches so a subsequent run can reconcile safely.

Use credentials limited to registry inventory/manifest reads and tag deletion in the allowed scope.
Kubernetes credentials need only resource get/list access in the two named namespaces.
The one-off operation uses existing `scw` configuration and `K8S_TENANT_ADMIN_KUBECONFIG_B64`.
Provision a dedicated two-namespace read-only Kubernetes credential and a scoped registry token
before CI activation; do not reuse tenant-admin credentials. The existing preprod CI credential
does not establish production access. Credential provisioning and verified RBAC are activation gates.
Keep credentials out of process argv. If decoding a kubeconfig to disk, use `umask 077`, mode 0600
and EXIT-trap removal. Kubernetes/git subprocesses must not inherit registry deletion credentials;
registry subprocesses must not inherit Kubernetes credentials.
Reference credentials by variable name only; never emit credentials, environment values,
raw API bodies or container logs. Receipts contain only allowlisted operational metadata.

Record namespace storage bytes before and after, including observation timestamps.
Per-tag sizes are not additive because layers are shared.
Also report deduplicated blob/config/manifest bytes reachable exclusively from DELETE tags and
unreferenced by KEEP tags in nc-reg; label this pre-GC quantity as an estimate.
Report the observed namespace storage delta separately from tag counts; asynchronous garbage
collection can delay reclamation, and other namespace activity can affect that delta.

Acceptance for implementation:

- Scoped tests prove unrelated namespaces/repositories are excluded and `N<10` is rejected.
- Fixtures cover the fixed cutoff, the 30-day boundary, newest-tag ordering and persistent pins.
- Fixtures preserve mutable `:main`, older running digests, index children and every protected alias.
- Missing access, incomplete pagination and unresolved metadata produce zero deletion calls.
- Conditional candidates can be verified absent; unresolved required references and ambiguous identifiers abort.
- Workload init containers, zero-replica rollback templates and runtime config-digest identities stay protected.
- Race tests cover new workload/Pod references, retagged candidates and competing publishers/deployers.
- Dry-run produces zero mutations; apply issues only eligible tag-UUID deletions.
- A repeated run is idempotent, and post-run verification confirms every protection remains resolvable.
- Evidence distinguishes non-additive tag sizes, estimated DELETE-only blob bytes and timestamped measured namespace storage changes.

The conductor records the proposal, acceptance and implementation handoff in Track from `BRANCH.md`
and the operational report at `.tmp/rv/registry-retention.md`, using the designated single writer.
