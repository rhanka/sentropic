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
- The API scheduler calls `reconcile` on active bindings and `recover` on
  interrupted intents only after the previous executor is fenced. `reap`
  enforces the absolute lifetime without forcing an early publication.

Idle builds always use the last verified commit and the existing pod, never
the dirty draft. A conflict/divergence skips the build. An unchanged head still
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
