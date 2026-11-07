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
  `createSupervisorTransport` (below) is that transport; pass it as `supervisor`
  and its `cleanInstall` as the dependency cache `cleanInstall`.

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
  source, install source and dependency trees 65,536 files / 16 MiB per file /
  512 MiB (`TREE_LIMITS`); an overlay 255 paths / 1 MiB per file / 8 MiB; the
  tarball set 64 MiB per tarball / 512 MiB. A tree over a limit fails `limit`.
- Ops and required echo: `phase {phase}` → phase; `terminate` → `treeGone: true`;
  `clear {paths}` → `cleared`; `stage`/`overlay`/`dependencies` → `treeDigest`
  (+ `revision`, + `readOnly: true`); `hostFile {path, source}` → `sha256`, with
  `path` one of the three host-owned files `/tmp/artifact-vite.config.mjs`,
  `/tmp/host-npmrc`, `/tmp/host-global-npmrc` (never the workspace), ≤ 64 KiB;
  `dev {recipe: 'live'}` → `revision`, `routeEpoch`; `build {recipe: 'build'}` and
  `install {recipe: 'install', tarballs}` → `exitCode: 0`. Recipes cross the
  wire by name; the bootstrap runs its frozen copy with the host environment.
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
