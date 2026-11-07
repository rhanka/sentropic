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
- For a remote host (D0), `createBuilderService` composes the host build API
  (`POST /v1/builds`, `GET /v1/builds/:artifactId/:jobId`), the Postgres job
  ledger and the A-LIVE §8.4 SG4b handoff from `@sentropic/artifacts/live-host`.
  The builder resolves only the host's pending job and registers its attempt
  fence; the host runs `acceptHandoff`, whose recheck covers every §8.3 item.
  Keys carry a `kid`, so builder and receipt keys rotate with an overlap.
  `createHttpRemoteHost` is the builder-side `RemoteHost` over the live-host
  `HOST_BUILD_PATHS` (https base URL from the host configuration): a closed
  refusal rejects with `LiveHostError`, any other failure is an unknown outcome.
- The API is mounted under `/api/v1/artifacts/builder` (`createBuilderMount`)
  behind `createRequireServiceAuth` with the `artifacts:builder` scope. The
  verified client maps to its host identity through
  `ARTIFACT_BUILDER_HOST_BINDINGS_JSON` = `[{clientId, hostId, storageScopeId}]`
  (owner sentropic). An absent or invalid value binds nothing (default deny).
  The ui nginx keeps this path out of its access and error logs.
- A host build run is presumed dead after its heavy-gate wait plus the four
  bounded build-only phases (`runStaleMs`), then it can be re-admitted.
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
epoch. Revisions are opaque strings of at most 128 characters. Pod slots are
admitted fairly across users; the capacity comes from per-environment
configuration, and slots held by pods that are not DORMANT are re-read before
the first decision after an API restart. One controller replica per environment
owns admission. One heavy phase at a time
runs per node (`createPostgresHeavyGate`): cold revive, wake, crash restore and
the idle or explicit clean build; HMR projection never waits for it. An
OOM-killed or evicted LIVE pod is replaced, after confirmed deletion, by a
fenced revive of the acknowledged draft, at most twice in a row.

Known limits of the heavy-phase gate:

- The advisory lock lives in each environment's database, so preprod and prod
  heavy phases do not serialize with each other on the shared node. That relies
  on the preprod quota window (pods 0 during owner sessions) until a shared lock
  or a split node exists; keep preprod plus prod admission at most 4 slots.
- If the API crashes mid-phase, its connection closes and the lock frees while
  the pod may still run that heavy step. Another phase can then overlap it, at
  most until the 5-minute phase deadline. After the restart the host calls
  `recover`, which fences and tears down that intent before any replacement.

Idle builds always use the last verified commit and the existing pod, never
the dirty draft. A conflict/divergence skips the build. An unchanged head still
builds, while publication additionally requires autoPublish, current policy,
new durable progress or the separately persisted initial exception, and the
release CAS. Wake and publication serialize on the same binding row lock.

Dependency cache keys include the exact lock SHA-256 plus scope/repository,
toolchain/image, platform, options/policy, workspace and integrity evidence.
The host authenticates receipts and verifies safe tree hashes at every use.
Missing integrity, including script-package literal pins, blocks admission.

## SG4b handoff keys

`builderKeys(process.env)` reads two values from the API environment secret
(never git, never logs; the owner `.env` names them only):

- `ARTIFACT_BUILDER_HANDOFF_SIGNING_KEY_JSON` = `{"kid","privateKey"}`: the
  builder's current Ed25519 key, PKCS#8 DER in base64. It signs the handoff and
  the host job request. The content host receives `builderPublicKey(...)`: the
  kid and the SPKI public key only.
- `ARTIFACT_BUILDER_HOST_RECEIPT_KEYS_JSON` = `[{"kid","publicKey"}]`: the
  content host's receipt public keys (SPKI DER, base64), at most 4 entries.

An absent or invalid value refuses to compose the builder service.

Rotation cycle: every 90 days, and at once on a suspected exposure.

1. Builder key: generate a new pair and a new kid, then send the public key and
   kid to the host. The host adds them next to the old kid.
2. Once the host confirms, replace the signing value and restart the API.
3. The host drops the old kid when no handoff signed with it is still valid
   (10-minute handoff lifetime).
4. Host receipt key: the host sends its new kid and public key. Sentropic adds
   them to the ring before the host switches. It removes the old kid after the
   host confirms the switch plus one handoff lifetime, because a resend may
   still return a receipt signed with the old kid.

Fake Kubernetes/forge tests live under `api/tests/unit/artifacts-live`; live
proxy/upgrade tests live under `apps/artifact-content/tests/live*`. They cover
controller behavior and native local HMR tunneling. They do not establish
cluster isolation, measured two-client HMR latency, relay availability, full
Immo integrity qualification or production substrate acceptance. Those remain
the frozen contract's real-cluster qualification gates and train review.
