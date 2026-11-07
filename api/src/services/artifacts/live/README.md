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
  Before the dev server it runs the separate `prebundle` heavy phase: the pod
  bootstrap writes its frozen host pre-bundle script itself (no host file) and
  runs it to completion; its output stays in the emptyDir cacheDir, never the
  shared cache.
  Bootstrap and this transport must be qualified together under GB4. An empty
  bootstrap, arbitrary shell or Kubernetes exec fallback is not provided.
  `createSupervisorTransport` (below) is that transport; pass it as `supervisor`
  and its `cleanInstall` as the dependency cache `cleanInstall`; its
  `sources.dependencies` is the dependency cache `materialize` stream.

## Supervisor transport

Workers have no egress in any phase (W2 static deny), so the supervisor pushes
every byte over the only worker ingress, TCP :5173, relayed by `artifact-content`
through `SupervisorChannel.send(target, frame, signal)` (raw reply bytes back).

- Frame: 64-byte Ed25519 signature, then the exact UTF-8 JSON body
  `{ v: 1, id, op, fence, issuedAt, expiresAt, args }`; at most 2 MiB; delivery
  window 30 s, clock skew 5 s, closed op set. `fence` = generation, sessionId,
  leaseEpoch, routeEpoch, podName, podUid. The private key stays in the API; the
  pod spec carries `supervisorPublicKey(key)` (SPKI DER, base64), never a secret.
  `openFrame` is the reference pod check, run before any operation.
- Pod duties (bootstrap): keep the highest fence per pod and refuse an older one
  (generation, lease, route; equality requires the same session and pod UID);
  keep a bounded set of frame ids seen within the delivery window and refuse a
  replay. The bootstrap owns :5173 in every phase; only in the live phase it
  forwards live HTTP and HMR to Vite on loopback, and serves nothing else.
- Reply: `{ id, ok, code?, data? }`, at most 2 MiB; `code` is `fenced`, `limit`,
  `integrity` or `failed`. Pod text is never read.
- Trees: `put { transfer, target, entries: [{ path, mode, size, offset, data }] }`,
  then one commit op carrying `{ transfer, treeDigest }`. `treeDigest` is the
  sha256 of the JSON list `[path, mode, size, sha256]` sorted by path; the pod
  recomputes it and applies the whole set atomically or nothing. Limits: staged
  source, install source and dependency trees 65,536 files / 64 MiB per file /
  1 GiB (`TREE_LIMITS`, decision 07/11 (a)); an overlay 255 paths / 1 MiB per
  file / 8 MiB; the tarball set 64 MiB per tarball / 512 MiB. A tree over a
  limit fails `limit`. Put frames are emitted as soon as one fills, and a
  streamed tree whose source fails part-way is never committed.
- Ops and required echo: `phase {phase}` → phase; `terminate` → `treeGone: true`;
  `renew {}` → `renewed: true`;
  `clear {paths}` → `cleared`; `stage`/`overlay`/`dependencies` → `treeDigest`
  (+ `revision`, + `readOnly: true`); `hostFile {path, source}` → `sha256`, with
  `path` one of the three host-owned files `/tmp/artifact-vite.config.mjs`,
  `/tmp/host-npmrc`, `/tmp/host-global-npmrc` (never the workspace), ≤ 64 KiB;
  `prebundle {recipe: 'prebundle'}` → `prebundled: true`; `dev {recipe: 'live'}`
  → `revision`, `routeEpoch`; `build {recipe: 'build'}` and
  `install {recipe: 'install', tarballs}` → `exitCode: 0`. Recipes cross the
  wire by name; the bootstrap runs its frozen copy with the host environment.
- Pre-bundle (decision 07/11 15:05): a separate op, so the cluster-mesh queue
  admits it on its own. The bootstrap writes its frozen pre-bundle script itself;
  no host file carries it. `dev` refuses with `failed` until a pre-bundle has
  run. The worker sends the live Vite config, then `prebundle`, then `dev`.
- Environments: the supervisor refuses, before sending, a `prebundle` or `dev`
  whose environment is not `artifactEnvironment()` (heap 384) and a `build`
  whose environment is not `buildEnvironment()` (heap 1024). W4 is the sole
  author of both functions and of every recipe in `recipes.ts`.
- Liveness: `renew` is fenced like every op and has no side effect; the pod
  renews its liveness lease on the frame and answers at once, so a renewal never
  cancels or waits for an in-flight command. The controller sends it at least
  every 60 s outside DORMANT.
- `snapshot { root: 'output' | 'dependencies', cursor }` →
  `{ entries: [{ path, type, mode, size, offset, data }], next }`. Output accepts
  regular files only, requires `index.html` and enforces 255 files / 16 MiB /
  64 MiB. The candidate digest is `candidateDigest` from
  `@sentropic/artifacts/live-host`, the one digest the builder handoff and the
  host verifier also use; it is computed and sealed on the trusted side after the
  build tree is gone, and an output it refuses fails `output_invalid`.
  `sources.candidate` receives the verified files and that digest: it is the
  candidate export the builder service consumes, with no second port.
- Install: tarballs are staged as `<index>.tgz` with their integrity; the
  bootstrap re-verifies and writes them content-addressed into the npm cache, then
  runs `INSTALL_RECIPE` = `npm ci --offline --ignore-scripts --no-audit --no-fund`,
  with no script allowlist. A missing entry refuses with `integrity`
  (`dependency_integrity_missing`) and makes no network attempt.
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
- For a remote host (D0), `createBuilderService` composes the host build API
  (`POST /v1/builds`, `GET /v1/builds/:artifactId/:jobId`), the Postgres job
  ledger and the A-LIVE §8.4 SG4b handoff from `@sentropic/artifacts/live-host`.
  The builder resolves only the host's pending job and registers its attempt
  fence; the host runs `acceptHandoff`, whose recheck covers every §8.3 item.
  Keys carry a `kid`, so builder and receipt keys rotate with an overlap.
- `builderPlacement(process.env)` supplies the per-environment worker namespace
  and service domain; there is no namespace constant.
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

The trusted cache streams (decision 07/11 (a')), because the API runs under a
512Mi limit. Each distinct installed file is one private object at
`dependency-cache/v1/files/<sha256>`, shared by every entry. The Postgres
pointer names one manifest object, `{ receipt, manifest }`, where each manifest
row is `[path, mode, size, sha256]`. The sealed receipt tree digest is unchanged:
the sha256 of the sorted `[path, mode, sha256]` rows. During a cold install,
tarballs are fetched and verified one at a time. Each exported file is written
to its object before the next snapshot page is read. `materialize` rechecks the
seal and the manifest, then rehashes each file as it is read into put frames.
A mismatch quarantines the entry. The API therefore holds one file (at most
64 MiB) and one bounded frame or reply. File objects are not garbage-collected.

Fake Kubernetes/forge tests live under `api/tests/unit/artifacts-live`; live
proxy/upgrade tests live under `apps/artifact-content/tests/live*`. They cover
controller behavior and native local HMR tunneling. They do not establish
cluster isolation, measured two-client HMR latency, relay availability, full
Immo integrity qualification or production substrate acceptance. Those remain
the frozen contract's real-cluster qualification gates and train review.
