# Artifact live controller

`createArtifactLiveService` composes the API controller with Postgres host state,
private immutable cache objects, the namespace-only Kubernetes client and the
qualified supervisor adapter. The API uses `sentropic-app`; worker pods use
`artifact-builder`, the fixed approved Node digest, emptyDir and restricted
security contexts. This factory does not activate a production workload.

The immutable pod name derives from scope and artifact, so replicas cannot
create two differently named workers for one binding. Session, generation,
lease, route and UID fences protect adoption, callbacks, replacement and
deletion. A failed checkpoint or unconfirmed deletion blocks replacement.

The host supplies these mandatory integrations:

- AL-T authenticates owner/source operations and serializes durable mutations.
  Call `wake` before admitting an edit against an idle attempt, then `project`
  after AL-D commits the current revision. Replay an old command without calling
  projection or renewing retention. Source reads can renew admitted activity;
  status/heartbeat traffic cannot.
- AL-D implements generation-qualified encrypted draft reads, checkpoint
  verification and empty-overlay head CAS. It retains old generations for
  teardown and never gives worker code draft-store credentials.
- The trusted supervisor implements bounded staging/process transport, complete
  process-tree termination, monotonic route fencing, atomic source projection,
  read-only verified dependency materialization and phase-fenced networking.
  Bootstrap and this transport must be qualified together under GB4. An empty
  bootstrap, arbitrary shell or Kubernetes exec fallback is not provided.
- The clean installer starts from the supplied verified source/lock in a fresh
  directory inside the leased pod, consumes the verified tarballs through the
  fixed npm configuration, suppresses hooks and exports only dependencies. It
  must never snapshot workspace source or a live directory into the cache.
- SG4 resolves admitted build jobs and commits release/index/receipt writes on
  the supplied Postgres client. The controller updates the B2 baseline in that
  same transaction. Every other publication path, including historical caller
  publication, must use this same scoped runtime lock and `publicationBaseline`
  after a final verified head observation. Never infer initial eligibility from
  a missing release pointer; branch publication history supplies that flag.
- The content host supplies separate live authorization/currentness and the
  staged-source/dependency path manifest to `createLiveProxy`. Inject that proxy
  into `startContentServer` for HTTP and websocket handling. Release grants do
  not authorize live source, and release-id routes remain immutable.
- The API scheduler (`createLiveScheduler`, one per environment, started by the
  composition) ticks at most every 30 s. Each tick sends one fenced liveness
  frame (`worker.renew`) to every pod that is not DORMANT and reconciles every
  key concurrently, so a crash restore or clean build never delays another key
  or any frame. `recover` runs on interrupted intents only after the previous
  executor is fenced.

There is no absolute pod lifetime (A-LIVE Amendment 1). `reap` is the idle
reaper: strictly after 900 s of server time since `lastAccessAt`, it ends on the
clean build of the last verified commit (or on the typed conflict, without a
build). Admitted MCP edits/reads and foreground viewing extend the session;
status polls, heartbeats, pings and liveness frames never do. Without a valid
frame for 30 minutes the bootstrap exits; the controller then restores the
durable draft (§5.5).

The package `LiveService` owns the revision model: revisions are opaque strings
and an edit is acknowledged once durable. `createLiveWorkerBridge` implements its
`LiveWorkerPort`: it wakes an idle attempt, then projects the durable draft and
reports `ready` only when the worker applied that exact revision.

Authority is the binding owner, i.e. the acting user. `authorize` returns the
route grant the host signs into its live assertion: writes for the binding owner
only, reads for the owner or an unexpired invitee of the current invitation
epoch. Revisions are opaque strings of at most 256 characters, the live-host
assertion bound (`MAX_SOURCE_REVISION_LENGTH`). Pod slots are
admitted fairly across users; the capacity comes from per-environment
configuration (4 on one d2-4 by default), and slots held by pods that are not
DORMANT are re-read before the first decision after an API restart. One
controller replica per environment owns admission. An OOM-killed or evicted
LIVE pod is replaced, after confirmed deletion, by a fenced revive of the
acknowledged draft, at most twice in a row.

Heavy phases go through the cluster-mesh heavy-phase queue of the builder node
(`createHeavyPhaseQueue`, durable in the host KV through
`createPostgresHeavyQueueStore`): the in-pod install, the Vite pre-bundle (its
own supervisor op), the dev server start and the clean build. The queue is a
strict FIFO: a phase is admitted when the pod bases, the live reservations, the
admitted phases and its own cost fit the node budget (1706 MiB on one d2-4;
provisional costs install 980, pre-bundle 980, dev 418, build 1344 MiB; the pod
base is measured per deployment). A finished dev start becomes its pod's live
reservation until the live stops. A build is admitted only when no live runs on
the node. Cold revive, wake and crash restore queue each phase in turn; HMR
projection never waits. An interactive waiter is refused with
`builder_unavailable`/`queued` past the configured wait and leaves the queue;
`controller.heavyStatus` exposes a pod's queued or admitted phases and position.

Known limits of the heavy-phase queue:

- The queue state lives in each environment's database, so preprod and prod do
  not share one node budget; each environment needs its own share of the node in
  configuration until the node is split or the queue store is shared.
- With the provisional costs, a pre-bundle fits beside at most one live, and four
  lives exceed 1706 MiB once the pod base is above 8 MiB.
- Tickets renew at a third of the entry TTL. If the API crashes mid-phase, its
  admitted ticket stays counted until the TTL expires while the pod may still
  run that step; queued tickets expire the same way. After the restart the gate
  re-seeds the pod and live holds from the durable runtimes, and the host calls
  `recover` on interrupted intents before any replacement.

Idle builds always use the last verified commit and the existing pod, never
the dirty draft. The reaper stops the live first, prepares the pod, then waits in
BUILD_QUEUED: every scheduler pass renews its ticket, and the build runs once
admitted; a wake cancels it. A conflict/divergence skips the build. An unchanged head still
builds, while publication additionally requires autoPublish, current policy,
new durable progress or the separately persisted initial exception, and the
release CAS. Wake and publication serialize on the same binding row lock.

Dependency cache keys include the exact lock SHA-256 plus scope/repository,
toolchain/image, platform, options/policy, workspace and integrity evidence.
The host authenticates receipts and verifies safe tree hashes at every use.
Missing integrity, including script-package literal pins, blocks admission.

Fake Kubernetes/forge tests live under `api/tests/unit/artifacts-live`; live
proxy/upgrade tests live under `apps/artifact-content/tests/live*`. They cover
controller behavior and native local HMR tunneling. They do not establish
cluster isolation, measured two-client HMR latency, relay availability, full
Immo integrity qualification or production substrate acceptance. Those remain
the frozen contract's real-cluster qualification gates and train review.
