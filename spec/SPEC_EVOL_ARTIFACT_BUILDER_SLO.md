Status: superseded on 13/11/2026 — the owner removed the builder VM and the k8s build pool; artifact builds move to spec/SPEC_EVOL_V8_ARTIFACT_DELIVERY.md

# SPEC_EVOL — Artifact Builder SLO: build under 1 minute (provider design)

> **Status**: design specification for implementation — Sentropic builder side.
> **Date**: 2026-11-11 (America/Toronto)
> **Owner requirement (verbatim)**: « un artefact doit se construire en moins
> d'1 min »
> **Consumer contract (normative input)**: immo
> `docs/spec/SPEC_ARTIFACT_BUILD_SLO.md` (`origin/main` at `c0ae9906f`, merged
> PR rhanka/radar-immobilier#1077). Its §3 SLOs (S1–S6, including the §3.1
> per-step joint allocation shared by Warm and Cold-known), §3.4
> zero-silent-failure rule and §7 acceptance scenarios are the acceptance
> reference for every lot below. This document specifies the builder/provider
> design that meets them; it does not relax any consumer target.
> **Incident evidence**: immo `LIVE-DISPATCH-REPORT.md` and companion forensic
> notes (`RECONCILE-REPORT.md`, `DISPATCH-REPORT.md`, `ATTACH-REPORT.md`,
> 2026-11-11 05:10–05:35Z, preprod read-only), plus the conductor's 2026-11-11
> preprod phase measurements reproduced in §3.
> **Code evidence**: `origin/main` of this repository at `7a352bb4d`
> (2026-11-11). Every "today" claim carries a `file:line` reference read at
> that commit; Appendix B indexes them. The branch
> `feat/artifact-builder-pool-d2-4` was also inspected: it contains only pod
> node-pool placement and memory sizing, already superseded on `origin/main`
> (`api/src/services/artifacts/live/pods.ts:59-60`, `:77-78`); it contains no
> warm-pool logic and no lot below depends on it.
> **Scope of this document**: design only. No code, no migration, no
> deployment change is made by this specification.

Tags: `[FACT]` = measured or read in code at the references above;
`[TARGET]` = normative requirement of this specification; `[DECISION]` = a
choice this specification makes and binds, with its fallback; `source-gap` /
`unverified` = no retained source, never used as a design premise without a
measurement gate.

---

## 1. Requirement restatement and design thesis

### 1.1 What must hold

1. `[TARGET]` End to end (consumer S6): a new artifact on an already-known
   lockfile reaches a published URL in **< 60 s per run, hard maximum**, p95
   < 40 s, Warm and Cold-known judged separately under the consumer §3.1
   joint allocation (attach 2 s / S1 15 s / S2 3 s / S3 5 s / S4 3 s / S5
   12 s p95; maxima sum 55 s).
2. `[TARGET]` Live start → `LIVE` < 30 s p95 (S1 Warm and S1c Cold-known),
   `live_write` → visible < 5 s p95 (S2), `git_commit` < 10 s p95 (S3),
   `stop` < 15 s p95 (S4), `git_publish` → `url_routable` < 25 s p95 and
   < 60 s max (S5).
3. `[TARGET]` A user's start or publish **never** runs a network dependency
   install. An unknown lockfile is a fast (≤ 5 s) typed rejection,
   `cache_not_prewarmed`, never a multi-minute install and never a silent
   `REVIVING` (consumer §3.3).
4. `[TARGET]` **Zero silent failures** (consumer §3.4): every failure returns
   a typed code with a `retriable` flag to the caller and emits one
   structured log line plus one persisted phase event (§7.6). Acceptance of an
   operation means a durable intent exists and a re-drive mechanism owns it
   until a terminal state.
5. `[TARGET]` No edge/MCP 502 on an operation that succeeds: no synchronous
   route exceeds 25 s server-side; anything longer is accepted
   asynchronously with a pollable invocation (§7.5).

### 1.2 Design thesis — why today is slow, in one paragraph

`[FACT]` The builder already has the right security skeleton (sealed,
HMAC-signed dependency manifests keyed by `lockSha256`, offline `npm ci`
from SRI-verified tarballs, fenced supervisor frames, atomic cache
admission). It is slow for exactly one structural reason: **every bulk
transfer moves file by file** — tarballs fetched and streamed one at a time,
the source tree re-downloaded then streamed per file, the installed tree
drained per file out of the pod and stored as one S3 object per file, then
re-fetched per file and re-streamed per file into the next pod — over a
frame relay that awaits each 768 KiB base64 frame in sequence
(measured ≈ 3.4 MB/s, `api/src/services/artifacts/live/deadline.ts:21-23`).
And it is unreliable for one structural reason: **dispatch is
fire-and-forget with a swallowed error and no re-drive on either side**
(`packages/artifacts/src/server/live-worker.ts:42`), so a failed first POST
strands the session in `REVIVING` forever. The design below therefore does
two things and only two things: (a) move every bulk transfer to **one
compressed archive per tree**, sealed out of band by a pre-warm contract so
the user path only ever mounts archives; (b) make every accepted intent
**durable, logged, retried and re-driven to a terminal typed state**. Warm
pods, incremental preview, async edge answers and per-phase metrics are
consequences layered on those two moves, in that order of value (§9).

### 1.3 Non-goals

- Changing the consumer SLO values, the MCP tool names, or the artifact
  content model.
- Weakening any existing fence, integrity or offline-install property
  (§5 lists the invariants every lot must preserve, with the test that pins
  each one).
- Replacing the supervisor-frame pod model or the `@sentropic/artifacts`
  package split (host runs LiveService, builder runs the controller).
- Any Python anywhere in implementation, jobs or probes. Stack stays
  Node/TypeScript plus the native binaries already present in the pinned
  builder image.

---

## 2. Consumer questions answered from the builder side

The consumer specification leaves six questions open (its §8.3). This
specification binds the builder-side answers; the owner may override, in
which case only the named contract surface changes.

| ID | Consumer question | `[DECISION]` of this specification |
| --- | --- | --- |
| **D1** | Q1 un-prewarmed request shape | **Fast typed rejection** `cache_not_prewarmed` (≤ 5 s, `retriable: true`, `lockSha256` and `cacheState` in detail) on both `live start` and `git_publish`, reverting any provisional start intent to `DORMANT` before returning. No queueing variant in v1: a queue whose completion the session cannot see is the failure mode being removed. §7.1.4. |
| **D2** | Q2 sealed-cache retention | A sealed unit is kept while referenced by a host pre-warm for `main` or a prod tag **and** for a 30-day floor after its last seal or last use, whichever is later. Eviction is a logged event and flips cache state to `absent`; it is never discovered by a failed start. §7.1.5. |
| **D3** | Q3 warm pool sizing | Minimum **1 warm pod per (tenant scope, hot `cacheKey`)**, pool ceiling set by namespace quota raised by the k8s lane (Lot 3 dependency: 4 pod slots). Cold-known meets both S1c (< 30 s p95) and the §3.1 joint S6 line (≤ 15 s p95, ≤ 20 s max) via parallel lookup/pod-bootstrap overlap, `zstd` archives and default-on sealed prebundle (§7.2, §7.4.3, §8.2); raising the pool minimum (`1 → 2`) reduces cold-miss probability under concurrent live traffic without altering §7.2 (which drains the pool before each run). §7.3. |
| **D4** | Q4 metrics surface | Dedicated builder API endpoints (`GET /v1/slo`, `GET /v1/metrics/phases`, `GET /v1/cache…`, `GET /v1/pool`), same S2S gate as builds, retention 30 days. §7.6. |
| **D5** | Q5 prod-tag pre-warming | Same asynchronous trigger as `main` merges; the request carries a `refKind: branch \| tag \| commit` field so retention can pin tag lockfiles. Host pipeline choice, builder accepts both. §7.1.3. |
| **D6** | Q6 error-code registry | Appendix A of this document, mirrored by code constants in `api/src/services/artifacts/live/records.ts` (builder) and `packages/artifacts/src/server/live-errors.ts` (package). New codes are added here first. |

---

## 3. Measured baseline (2026-11-11, preprod, cold lockfile)

`[FACT]` Conductor-measured phase decomposition of one cold install on the
user path tonight. Step names are the builder's own install-step log names
(`artifact_live_install_step`, `api/src/services/artifacts/live/deadline.ts:127`).

| Step | Measured | Volume / mechanism |
| --- | --- | --- |
| `cache_lookup` | 3–8 ms | Sealed-manifest miss (Postgres pointer + S3 GET) |
| `heavy_admit` | 6–18 ms | Heavy-phase queue admission for the `install` phase |
| `forge_redownload` | 21–23 s | 187 MB, 4 004 files — the pinned commit tarball is downloaded a second time and expanded |
| `source_transfer` | 35–41 s | Whole source tree streamed file by file into the install pod |
| `tarball_stream` | 108–112 s | 384 MB, 481 tarballs fetched serially via the npm relay, streamed serially to the pod |
| `recipe` (`npm ci` in pod) | 30 s | Frozen offline `npm ci` |
| `drain` | **> 999 s** (cut) | Installed tree (immo: 49 318 files / 816 MiB, `api/src/services/artifacts/live/supervisor-transfer.ts:14`) streamed file by file out of the pod, one S3 PUT per file on the API side |
| **Total before any build** | **≈ 3.5 min of steps + unbounded drain** | First cut at the 20 min install ceiling (`phase_timeout:install:drain`); ceiling since raised to 45 min by environment override, which converts the failure into a 45-minute wait |

`[FACT]` Reliability baseline (immo `LIVE-DISPATCH-REPORT.md`, proven there):
no live draft has ever reached `LIVE` in preprod (6 drafts ever: 4 stuck
`REVIVING`, 1 `QUIESCING` since 2026-11-08, 1 never started); live dispatch
is one fire-and-forget call whose failure is swallowed with no log;
`live_write`/`git_commit` returned Cloudflare 502 while the operation landed
20–30 s later; API restarts kill in-flight installs; `stop` on an orphan
`REVIVING` record is refused. Against consumer §3 this system meets **zero**
SLOs today, and §3.4 is violated by construction.

`source-gap`: the exact builder response to the failed
`POST v1/live/draft/page|seal` calls (status + body) was not visible from
the immo side. Lot 2 makes that class of unknown impossible (every dispatch
attempt is logged with its status on both sides); no lot depends on
recovering the historical value.

---

## 4. Today's design, with evidence (as-is at `7a352bb4d`)

This section records only what the code does now, so each design change in
§7 can cite the exact mechanism it replaces. "Builder" below is the
Sentropic API-side controller (`api/src/services/artifacts/live/**`);
"package" is `@sentropic/artifacts` (`packages/artifacts/**`), whose
LiveService runs inside the host process (immo `radar-immo-mcp` in preprod).

### 4.1 Dependency cache: sealed manifest exists, but sealing runs on the user path

- Cache identity already keys on the lockfile hash plus toolchain:
  `CacheIdentity.lockSha256` and
  `cacheKey = lockSha256/sha256([scope, repo, platform, node, npm, image, policy, topology, integrityDigest, workspaces])`
  (`api/src/services/artifacts/live/cache.ts:11-17`, `:50-53`). Receipts are
  HMAC-sealed and re-verified with the manifest tree digest on every read
  (`cache.ts:83-98`, `:164-179`). Admission is atomic: a partial entry is
  never visible (`cache.ts:41-42`; storage
  `api/src/services/artifacts/live/cache-storage.ts:165-173`).
- But the single entry point `acquire()` does lookup-or-install inline: on a
  miss it fetches every tarball, runs the clean install in a pod, sinks every
  installed file to per-file S3 objects, then admits
  (`cache.ts:100-162`; serial tarball generator `:131-138`; per-file sink
  `:140-146`). Both user paths call it directly: live prepare
  (`api/src/services/artifacts/live/prepare-live.ts:42`) and static build
  (`api/src/services/artifacts/live/build-only.ts:163`), plus the idle build
  (`api/src/services/artifacts/live/idle.ts:46`). **A cache miss on a user's
  start or publish therefore pays the full §3 cold install.** There is no
  pre-warm endpoint, no queryable cache state, and no
  `absent|building|sealed|failed` machine anywhere: storage exposes only
  `read | admit | quarantine | putFile | getFile` (`cache.ts:39-47`).
- Warm materialization is not cheap either: `materialize()` re-reads the
  manifest, then for **each** entry does one S3 `getFile` plus a full
  rehash, yielding one file at a time (`cache.ts:174-178`), and the
  supervisor streams those files into the pod
  (`api/src/services/artifacts/live/supervisor.ts:79-89`) where the agent
  places each file, derives bin/workspace links and recursively freezes the
  tree (`api/src/services/artifacts/live/bootstrap-materialize.ts:64-83`).
  For the immo tree that is ~49k S3 GETs and ~49k relayed files on every
  cold pod, warm cache or not.

### 4.2 Clean install: five serial bulk transfers, drain is the unbounded one

`createCleanInstall` (`api/src/services/artifacts/live/supervisor-install.ts:23-104`)
runs, in order: `forge_redownload` — `source(stagingRef)` downloads the
pinned commit **again** and checks it against the staged manifest
(`:35-38`; the forge reader's `source()` is documented "Re-downloads the
recorded commit", `api/src/services/artifacts/live/forge-lease.ts:126-133`);
`source_transfer` of the full tree (`:48-52`); `tarball_stream` of the
serially fetched tarballs (`:55-69`; each fetch is relay-only, SRI-checked,
30 s timeout, `api/src/services/artifacts/live/npm-relay.ts:6-33`); the
frozen `npm ci --offline --ignore-scripts` recipe in the pod (`:75-87`;
recipe frozen at `api/src/services/artifacts/live/recipes.ts:62-64`,
300 s timeout); then `drain` — every regular file of the installed tree is
snapshot-streamed out of the pod and handed to the cache sink, which writes
**one S3 object per file** (`:90-99` into `cache.ts:140-146`). Transfers ride
signed supervisor frames of 768 KiB chunks, base64, **awaited one at a
time** (`api/src/services/artifacts/live/supervisor-transfer.ts:11`,
`:54-69`; `api/src/services/artifacts/live/supervisor-channel.ts:81-93`).
The install watchdog is progress-based with a 20 min default ceiling and an
environment override (`api/src/services/artifacts/live/deadline.ts:28`,
`:40-44`); lookup and admission each allow 120 s (`deadline.ts:120-123`).
The comment at `deadline.ts:21-27` prices the cold path explicitly in the
source itself: ~5 min of fetch at ~3.4 MB/s plus transfer, `npm ci` and
drain. Raising the ceiling (tonight, to 45 min) changes only how long the
user waits.

### 4.3 Pods: created per session on demand, no pool, identity is fused

- A pod is created during `prepareLive` through the heavy-phase pod slot
  (`prepare-live.ts:34`), after the runtime row exists. Pod slots are
  capped at **2 per environment**, shared by live and build pods
  (`api/src/services/artifacts/live/service.ts:36`;
  `api/src/services/artifacts/live/product-builder.ts:35-37`), because each
  pod books 1536 Mi of the 3 Gi tenant memory request quota
  (`api/src/services/artifacts/live/pods.ts:73-78`). One heavy phase at a
  time runs under the node budget (install 1370 MiB of a 1641 MiB budget,
  `product-builder.ts:35-37`); a heavy wait can last 600 s before a typed
  `queued` failure (`api/src/services/artifacts/live/heavy.ts:77-102`).
- Pod identity is fused with binding identity: the pod name is a
  deterministic hash of (scope, artifact) (`pods.ts:8-16`), the descriptor
  refuses any other name (`pods.ts:54`), `liveViteConfig` independently
  enforces `/^artifact-[a-f0-9]{40}$/` on `podName` (`recipes.ts:96`), labels
  carry session/generation/lease (`pods.ts:11-16`), and the same
  `podName(key)` string is reused as the storage-row key for remote drafts,
  fences and forge bindings
  (`api/src/services/artifacts/live/remote-drafts.ts:41-95`,
  `api/src/services/artifacts/live/remote-live.ts:28-29`,
  `api/src/services/artifacts/live/forge-binding.ts:95`). `ensure()` deletes
  an older-lease pod and waits for its 404 before creating the replacement
  (`pods.ts:187-198`). Inside the pod, `frameFence` enforces strict
  monotonicity of `(generation, leaseEpoch, routeEpoch)` over the pod's
  entire lifetime (`api/src/services/artifacts/live/bootstrap-frame.ts:54-60`)
  and `checkLease` exits with code `3` after 30 minutes without a valid
  fenced frame (`bootstrap-frame.ts:14`, `:90-95`;
  `api/src/services/artifacts/live/bootstrap-server.ts:121-123`) — so an
  unrenewed idle pod self-terminates, and a pod released from generation `5`
  could never accept a subsequent claim at generation `1`. There is no
  concept of an idle, pre-created or reusable pod; teardown always deletes
  pod and service (`api/src/services/artifacts/live/transitions.ts:43-78`).
- The Kubernetes port is minimal: `get | create | delete | waitDeleted`
  (`pods.ts:175-181`) — no list, no label patch. A pool needs both.

### 4.4 Live preview: a Vite dev server, re-projected on every write

The live runtime is the stock Vite dev server on loopback
(`recipes.ts:67-70`) behind the bootstrap proxy, pre-bundled once during
prepare (`recipes.ts:73-90`, `prepare-live.ts:45-46`). But a host
`live_write` does not ride Vite's watcher: `projectRevision` flips the
session `LIVE → REVIVING`, **revokes the route**, restores the full overlay
into the pod and re-runs the `live` step before marking the revision
applied (`api/src/services/artifacts/live/project.ts:19-42`). Every write
therefore pays a re-projection and a route flap, and "visible" has no
served-revision proof in the ACK.

### 4.5 Dispatch: fire-and-forget, swallowed, unexported, never re-driven

- Package side: after the durable mutation, `settleLiveWorker` is awaited
  **only for stop**; start/write dispatch is `void settling`
  (`packages/artifacts/src/server/live-service.ts:163-167`), and
  `git_commit` has a second fire-and-forget site
  (`packages/artifacts/src/server/live-commit.ts:110`). Inside, every error
  is dropped by `catch { /* The durable intent remains available to the
  controller's fenced reconciliation. */ }`
  (`packages/artifacts/src/server/live-worker.ts:42`) — with no logger in
  the worker client at all, and every non-200 HTTP response from the builder
  collapsed into an untyped `provider_unavailable`
  (`packages/artifacts/src/live-host/worker-client.ts:88-155`, `:138`). In
  addition, `worker.reconcile(record)` requires `record.runtime` fences to be
  non-null (`worker-client.ts:129-130`): calling live reconcile on a static
  attach-only artifact (`record.runtime === null`) throws
  `provider_unavailable` before reaching the network (`DISPATCH-REPORT.md`),
  even though the builder's static build path seeds binding fences directly
  from `HostJob` (`build-only.ts:25-55`) without any prior live reconcile,
  and `POST /v1/builds` currently admits the job and answers `202` before
  checking whether the dependency cache is sealed (`host-build-api.ts:54-70`).
  On the live path, the durable intent does exist: `mutateLive` commits
  `phase: REVIVING` with `appliedRevision: null` before `settleLiveWorker`
  runs (`live-service.ts:156-167`), and `workerPending` is derived from
  `appliedRevision !== revision`
  (`packages/artifacts/src/server/live-mutations.ts:55-73`). But
  `settleLiveWorker` is not exported from the package (no
  `./server/live-worker` subpath in `packages/artifacts/package.json`
  exports; only internal imports exist), so **a host cannot schedule a
  re-drive even if it wants to**.
- A repeated explicit `live_control(start)` on a `REVIVING` record is
  refused `active_session` unless the origin was implicit
  (`live-mutations.ts:52`), so an operator cannot re-trigger dispatch.
  `stop` requires a matching session identity and revision preconditions
  (`live-service.ts:51-54`, `:70-74`; `live-mutations.ts:19-22`) and awaits
  `worker.stop`; on a record whose dispatch never landed, that call cannot
  settle — the orphan cannot be closed through the API (immo report §2;
  one draft has sat in `QUIESCING` since 2026-11-08).
- Builder side: a 30 s scheduler exists
  (`api/src/services/artifacts/live/product-builder.ts:33`, `:136-140`;
  `api/src/services/artifacts/live/scheduler.ts:15-43`), but its
  `REVIVING` branch only probes the pod: **if the pod is active it returns
  and leaves the runtime alone** (`api/src/services/artifacts/live/controller.ts:61-70`).
  After an API restart the in-process install stream is gone
  (timers and generators in `deadline.ts:86-117` and `cache.ts:131-138` are
  process memory), the pod may still be active, and nothing ever resumes
  the revive. Static builds have the mirror defect: the run is started by
  an in-process `schedule(work)` that fire-and-forgets with a log on failure
  (`product-builder.ts:123`;
  `api/src/services/artifacts/live/host-build-api.ts:68`), and an accepted
  job is only considered stale after
  `2 × (600 s heavy wait + ceiling + 3 × 300 s)` — 90 minutes at the default
  ceiling — before it may be re-admitted
  (`api/src/services/artifacts/live/build-jobs.ts:13-14`, `:37-39`).
- The one sound pattern already present: host reconcile answers within a
  25 s wait with `ready: false` while the revive continues
  (`api/src/services/artifacts/live/host-live-api.ts:47-56`;
  `product-builder.ts:41`), and builds already answer 202 + poll
  (`host-build-api.ts:54-76`). §7.5 generalizes exactly this.

### 4.6 Metrics: structured logs only, keyed by an opaque hash

Per-step and per-phase durations are logged as `artifact_live_install_step`
and `artifact_live_phase` lines (`deadline.ts:124-131`, `:197-227`), but the
phase key is `sha256(scope, artifactId)` (`deadline.ts:189-192`) — a
conductor who knows an artifact id cannot query its history without
recomputing preimages per scope, and nothing is persisted: no phase-event
store, no metrics endpoint, no cache-state or pool surface, no SLO
aggregation. Queue position per binding is the only live status extra
(`controller.ts:142`). Consumer §7 acceptance numbers cannot be produced
from today's builder at all.

---

## 5. Invariants every lot must preserve

`[TARGET]` Speed is obtained by moving work off the user path and by
changing transfer shapes — never by weakening a check. Each invariant names
the existing mechanism that carries it today; the lot that touches that
mechanism re-pins it with a test (§9).

1. **Offline install from pinned tarballs only.** Tarballs are fetched
   through the npm relay allowlist and SRI-verified before any pod sees
   them (`npm-relay.ts:9-12`, `:32`; `cache.ts:131-138`); pods run
   `npm ci --offline --ignore-scripts` with a host-owned environment, no
   branch `.npmrc`, no registry access from the pod (`recipes.ts:28-36`,
   `:61-64`).
2. **Sealed means immutable and verified.** A cache entry is admitted
   atomically and completely or not at all (`cache.ts:41-42`); the receipt
   HMAC and tree digest are re-verified on every use (`cache.ts:88-98`).
   Archive materialization (§7.1) verifies the archive digest against the
   sealed receipt before extraction and the tree digest after it.
3. **Fences before frames.** Every supervisor frame is signed and fenced
   by (session, lease, route epoch, pod uid); a stale fence never touches a
   pod (`api/src/services/artifacts/live/records.ts:50-53`;
   `supervisor-channel.ts:49-72`). Pool claim (§7.3) and fast projection
   (§7.4) add fenced operations; they never bypass the frame fence.
4. **Scope comes from the S2S identity, never from a body.** All new
   endpoints sit behind the existing `hostGate`
   (`api/src/services/artifacts/live/host-build-api.ts:16-21`) and take the
   storage scope from the authenticated host, exactly like builds and live
   reconcile today.
5. **A cut or failed operation never poisons shared state.** Failed seals
   quarantine or stay `failed(typed)`; failed dispatches land in a typed
   terminal state with the binding lock released; a failed pool scrub
   deletes the pod instead of returning it to the pool.
6. **No secret in logs, events or error details.** Error details keep the
   existing discipline: closed `code:reason` in ledgers, scrubbed bounded
   tails log-only (`records.ts:40-44`; `deadline.ts:220-224`). Phase events
   (§7.6) carry ids, hashes and durations only.
7. **Deterministic names stay deterministic where storage relies on
   them.** The physical/logical pod-name split (§7.3.2) keeps the binding
   row keys unchanged; only the Kubernetes pod/service names become
   claim-time values.

---

## 6. Target architecture (overview)

```
host CI (merge to main / prod tag)                user (MCP)
        | POST /v1/cache/prewarm                      | live start / git_publish
        v                                             v
+--------------------------- builder ---------------------------+
| cache state machine      absent -> building -> sealed|failed |
| prewarm job (durable):   forge snapshot (once, cached)       |
|   -> tarball store (SRI-keyed, delta fetch, parallel)        |
|   -> install pod: npm ci --offline -> tar.zst seal in pod    |
|   -> prebundle seal (/tmp/vite-cache tar.zst, default on)    |
|   -> ONE archive object + sealed manifest in cache S3        |
|                                                              |
| user path: requireSealed() lookup only (<= 5 s or typed      |
|   cache_not_prewarmed, pre-revive / pre-admit) ->            |
|   pool claim OR (pod create || snapshot+S3 stream open) ->   |
|   concurrent tar.zst extract (/dependencies, /workspace,     |
|   /tmp/vite-cache) -> overlay -> vite dev / vite build       |
|                                                              |
| dispatch: durable intent -> awaited first attempt ->         |
|   re-drive scanners (package host side + builder side) ->    |
|   terminal LIVE | published | typed failure                  |
| metrics: phase events per invocation -> /v1/slo aggregates   |
+--------------------------------------------------------------+
```

Three transfer shapes replace the five file-by-file shapes of §4.2:
**source unit** (one filtered `tar.zst` per pinned commit, built once from
the forge tarball the builder already downloads, cached in the builder cache
bucket), **sealed dependency unit** (one `tar.zst` of the installed tree per
`cacheKey`, produced inside the install pod at seal time), and **prebundle
unit** (one `tar.zst` of the Vite optimizer cache per `cacheKey` + base tree,
sealed by default during prewarm, §7.4.3). All three use Node's built-in
`node:zlib` `zstd` streams (`createZstdCompress` / `createZstdDecompress`,
native in both `api/Dockerfile:11` Node 24 and `BUILDER_IMAGE` Node 26.13.0,
`recipes.ts:3-6`), ride one pipelined archive transfer (§7.2), and are
extracted concurrently across the three independent `emptyDir` mounts by the
trusted bootstrap agent in the pod.

---

## 7. Detailed design

### 7.1 Pre-warmed, sealed dependency cache per `lockSha256`

#### 7.1.1 Split `acquire()` into `requireSealed()` (user path) and `seal()` (prewarm only)

`[TARGET]` `createDependencyCache` (`cache.ts:74`) gains two entry points
and loses the combined one on user paths:

- `requireSealed(source, runtime?)` — GB1 qualification and identity checks
  unchanged (`cache.ts:104-121`), then **lookup only**: sealed hit returns
  the verified receipt; miss, quarantine or state `building`/`failed`
  throws `LiveError('cache_not_prewarmed', lockSha256)` — typed,
  `retriable: true` at the host boundary. Internal budget: the whole call
  is bounded at **5 s** (a new `SEALED_LOOKUP_TIMEOUT_MS`, replacing the
  120 s lookup bound of `deadline.ts:120` on this path; a Postgres SELECT +
  one manifest GET has no business exceeding 5 s, and exceeding it is a
  typed `builder_unavailable:cache_lookup_timeout`, itself an SLO defect
  signal in §7.6). Callers: `prepare-live.ts:42`, `build-only.ts:163`,
  `idle.ts:46` — the idle build on an unsealed lockfile skips with a typed
  log line instead of installing.
- `seal(source, job)` — today's miss branch (`cache.ts:130-162`) plus the
  §7.1.2 archive production, callable **only** from the prewarm job
  (§7.1.3). It runs under a dedicated prewarm budget (§7.1.6), never under
  any user-visible timeout.

`[TARGET]` The install ceiling environment override
(`ARTIFACT_INSTALL_CEILING_MS`, `deadline.ts:13`) is removed from the user
path entirely once `requireSealed` lands; the preprod 45 min override is
deleted in the same change. Raising any ceiling named in this specification
requires amending this specification — a ceiling raise is never a fix.

#### 7.1.2 Sealed unit: one archive per `cacheKey`, produced in the install pod

`[DECISION]` (**D7**) The sealed unit is a **single deterministic `tar.zst`
of the installed dependency tree** plus the existing sealed manifest, stored
in the builder's own cache bucket under the established key discipline
(`cache-storage.ts:39-53` gains a third admitted shape:
`artifact-builder-cache/v1/<lockSha>/<keySha>/sealed-<treeSha256>.tar.zst`).
`zstd` via built-in `node:zlib` (`createZstdCompress` level 3 at seal time,
`createZstdDecompress` on extract — present in both the API Node 24 image and
`BUILDER_IMAGE` Node 26.13.0, `recipes.ts:3-6`) is chosen over `gzip` because
single-core `zstd` decompression runs 3–5× faster than `gunzip` at slightly
smaller object size, keeping cold-pod extraction comfortably inside the §8.2
Cold-known joint budget without adding any external binary.

Production (inside `seal()`, install pod):
1. The pod installs exactly as today (offline, SRI-staged npm cache,
   `bootstrap-deps.ts:147-166`).
2. A new trusted agent op `sealDependencies` walks the installed tree once,
   computing the manifest rows `[path, mode, size, sha256]` (the same rows
   `manifestDigest` already defines, `supervisor-transfer.ts:43-47`) while
   streaming a `tar.zst` (ustar headers, sorted paths, modes 0444/0555,
   zeroed mtime/uid/gid and deterministic `zstd` parameters) to a scratch
   file, then streams that one
   file back through the existing snapshot channel as **one file spanning
   frames** (a shape `putWriter`/`streamSnapshot` already support:
   `supervisor-transfer.ts:58-66`). The per-file `drain` op and the API-side
   per-file sink are deleted; the `drain` install step disappears from the
   step vocabulary (its budget line in §8 goes to zero by construction).
3. The API stores the archive as one S3 object (multipart above the SDK
   threshold), verifies `sha256(archive)` against the value the agent
   computed while producing it, recomputes the tree digest from the agent's
   manifest rows, then admits `{receipt, manifest, archive:{ref, sha256,
   bytes}}` atomically through the existing pointer swap
   (`cache-storage.ts:165-173`). The agent is host bootstrap code, not
   repository code — the same trust boundary that already computes the
   install result (`bootstrap-deps.ts` header). Repository code never runs
   during sealing (install hooks are disabled, `recipes.ts:34`).

Consumption (`materialize` replacement, `cache.ts:166-179`):
1. Verify receipt HMAC + manifest tree digest as today (`cache.ts:88-98`).
2. Stream the **one archive object** from S3 and relay it as one file
   (§7.2 pipelining), intended budget §8. No per-file S3 GET, no per-file
   rehash on the API side.
3. In the pod, the agent verifies the archive sha256 while streaming through
   `createZstdDecompress` (Node `node:zlib`), extracts with the bounded ustar
   reader of §7.2.3 directly under `/dependencies`, recomputes the tree
   digest over extracted rows and refuses on mismatch
   (`sealed_unit_invalid` → quarantine on the API side), then runs the
   existing link-derivation and freeze
   (`bootstrap-materialize.ts:17-63`) unchanged.

`[DECISION]` (**D8**) Per-file objects (`files/<sha256>`, `cache-storage.ts:177-178`)
are **not** written for new seals. Existing per-file entries stay readable
through one transition release (materialize falls back per entry when
`archive` is absent), then the fallback and the sink are removed; orphaned
per-file objects are reaped by the retention job (§7.1.5). An OCI image
layer per `cacheKey` was considered and deferred (§11): it needs registry
push credentials and an image build inside the builder, while the archive
reuses the storage, relay and agent already qualified. The sealed-unit
interface (`archive:{ref, sha256, bytes}` on the receipt) is the seam if a
later decision moves transport to kubelet image pull — no host contract
would change.

`unverified`: the exact compressed size of the immo installed tree. The
archive budget in §8 assumes ≤ 1 GiB uncompressed (the `TREE_LIMITS` bound,
`supervisor-transfer.ts:15`; immo measured 816 MiB) and a typical `zstd -3`
ratio on `node_modules` (~150–190 MiB); Lot 1 carries a measurement gate
(§9, L1-G) that records real bytes/ms in preprod before the cold-known budget
is declared met.

#### 7.1.3 Pre-warm trigger contract (host → builder)

`[TARGET]` New endpoints on the existing builder mount
(`/api/v1/artifacts/builder`, `api/src/routes/artifacts-builder.ts:15-25`),
behind the same `hostGate` S2S authentication (scope `artifacts:builder`).
Bodies are closed (unknown fields refuse), following the existing
host-build/host-live discipline (`host-build-api.ts:54-62`,
`host-live-api.ts:60-64`).

**Request sealing:**

```
POST /v1/cache/prewarm
{
  "binding": { "repoId": "...", "branch": "main", "subPath": "ui" },
  "commitSha": "<40-hex pinned commit>",
  "refKind": "branch" | "tag" | "commit",
  "lockSha256": "<64-hex sha256 of the lockfile bytes at commit/subPath>",
  "installWorkspaces": ["ui"],        // optional assertion, see below
  "prebundle": true,                  // optional, default true (§7.4.3)
  "idempotencyKey": "<host-chosen, <= 128 chars>"
}
```

- The builder derives the complete `CacheIdentity` itself, through the
  **same snapshot machinery the user path uses** — this identity equality
  is load-bearing, because a prewarm that seals under any other derivation
  produces a `cacheKey` no start will ever hit. Concretely: a new
  repo-scoped forge read `snapshotRepo(scope, binding, commitSha)` builds
  its target through the existing registry admission
  (`admitBinding(config, scope, binding)`,
  `api/src/services/artifacts/live/forge-binding.ts:81-86` — the binding
  body shape `{repoId, branch, subPath}` is reused verbatim via
  `bindingOf`, `forge-binding.ts:40-46`) instead of an artifact-generation
  binding row (`forge-lease.ts:47-52`), then returns the identical
  `SourceSnapshot`, cache identity assembly included
  (`forge-lease.ts:99-124`: toolchain constants from `recipes.ts:3-6`,
  policy-revision and topology digests, GB1 integrity digest).
  `installWorkspaces` in particular comes from the builder's repository
  registry entry (`forge-binding.ts:13-19`), never from the host: the body
  field is an optional assertion, and a value unequal to the derived
  selection is `422 {error: "lock_mismatch", retriable: false}` (same
  refusal family, reason names the field). The builder **verifies**
  `sha256(lockfile at commitSha/subPath) === lockSha256` from that
  snapshot; a mismatch is the same 422. The host never supplies lockfile
  bytes. `branch` is used for admission and retention current-ref
  tracking (§7.1.5) only — content is pinned by `commitSha`.
- Responses: already sealed → `200 {lockSha256, cacheKey, state: "sealed",
  treeSha256, files, bytes, sealedAt}`; new or in-progress →
  `202 {lockSha256, cacheKey, state: "building", jobId, startedAt}`.
  Repeat calls with the same identity join the in-flight job (idempotent
  per `cacheKey`; `idempotencyKey` deduplicates retries of the same trigger
  and is echoed in phase events). Refusals use the shared refusal mapping
  (`host-live-body.ts refusal`) extended per Appendix A.
- Trigger points are the host's (consumer §6.3): immo CI on merge to `main`
  changing a consumed lockfile, on prod-tag creation, and on conductor
  manual request. A trigger failure is a host pipeline failure (typed,
  logged) — never a silent skip; until sealing completes, §7.1.4 applies.

**Query state:**

```
GET /v1/cache?lockSha256=...&repoId=...&subPath=...&installWorkspaces=ui
-> 200 { entries: [ { lockSha256, cacheKey, state, treeSha256?, files?,
       bytes?, sealedAt?, jobId?, step?, error?: {code, reason, retriable} } ] }
GET /v1/cache/by-key?cacheKey=<url-encoded cacheKey>   (exact poll; the
     cacheKey contains a '/', so it travels as a query value, never a path
     segment)
```

`state` is exactly the consumer vocabulary:
`absent | building | sealed | failed`. Multiple identity variants (e.g.
different workspace selections over one lockfile) return one entry each;
the host stores the `cacheKey` from its prewarm response for exact polling.
`step` while building uses the install-step vocabulary
(`forge_snapshot | tarball_fetch | recipe | seal_archive | admit`) so a
stuck seal is diagnosable from the same read the dashboard uses.

**State storage and execution.** Cache state is durable, in a new KV
namespace `artifact-builder-cache-state/v1` over the same
`control.artifact_host_kv` store the heavy queue and cache pointers already
use (`heavy.ts:139-160`, `cache-storage.ts:146-173`) — **no database schema
change**. A prewarm is a durable job record `{cacheKey, state, jobId,
step, heartbeatAt, attempts, error?}` executed by a `CacheJobs` runner
modelled on the build-job ledger (`build-jobs.ts:27-64`): admission is
compare-and-swap on the state row, only the current job token may complete
or fail the seal. The job runs `seal()` on a builder pod obtained through
the heavy queue at **yielding priority**: admission is attempted with a 5 s
wait and retried every 60 s (the queue's `keep` durable-waiter shape,
`heavy.ts:15-18`) so a prewarm for the *next* lockfile never starves a user
build on the current one beyond one in-flight heavy phase. The phase events
of §7.6 record queue wait explicitly.

#### 7.1.4 User path on an unsealed lockfile (live start, static publish, idle)

`[TARGET]` `live start`, `git_publish` and the idle build on a lockfile
whose state is `absent | building | failed` reject within **≤ 5 s** with
`409 {error: "cache_not_prewarmed", retriable: true, lockSha256, cacheState}`
from the builder, surfaced verbatim by the package/host to the MCP caller
(consumer §3.3, §7.3.1). Both user paths require explicit pre-admission
checks so neither leaves behind a half-started runtime or a fake `202`:

1. **`live start` path (`live-service.ts:156-167`, `worker-client.ts:129-138`,
   `host-live-api.ts:47-56`):**
   - Today `mutateLive` commits `record.runtime.phase = 'REVIVING'` and writes
     the command receipt *before* `settleLiveWorker` runs (`live-service.ts:156-167`),
     because `worker.reconcile(record)` requires `record.runtime` fences to
     exist (`worker-client.ts:129-130`), and `worker-client.ts:138` collapses
     every non-200 HTTP response into `provider_unavailable`.
   - Target flow: on `POST /v1/live/reconcile`, the builder resolves
     `forge.snapshot` and calls `cache.requireSealed` (bounded at ≤ 5 s)
     **before** `revive()` writes any builder runtime row or touches a pod,
     answering `409 {error: "cache_not_prewarmed", retriable: true,
     lockSha256, cacheState}`. `worker-client.ts` parses structured builder
     refusal bodies and throws `ArtifactOperationError('cache_not_prewarmed',
     ...)` instead of `provider_unavailable`. When the awaited
     `settleLiveWorker` (§7.5.1) catches `cache_not_prewarmed` on an initial
     `DORMANT → REVIVING` transition, it atomically rolls `record.runtime`
     back to `DORMANT` (`stateDetail: 'cache_not_prewarmed'`,
     `workerPending: false`), voids the unfulfilled start receipt so a retry
     after sealing executes cleanly, emits one structured log + phase event,
     and rethrows `cache_not_prewarmed` to the MCP caller inside the 5 s
     budget. The session **never** remains in `REVIVING`.
2. **`git_publish` static path (`host-build-api.ts:54-70`,
   `build-only.ts:25-55`):**
   - Today `POST /v1/builds` admits the job and answers `202 build_pending`
     before `buildOnly` ever inspects the dependency cache.
   - Target flow: `POST /v1/builds` resolves the job's commit snapshot and
     runs `cache.requireSealed` synchronously (≤ 5 s bound) **before**
     `jobs.admit`, returning `409 {error: "cache_not_prewarmed",
     retriable: true, lockSha256, cacheState}` immediately on an unsealed
     lockfile. In addition, for attach-only static artifacts (`record.runtime
     === null`), the host submits directly to `POST /v1/builds` — where
     `admittedBinding` (`build-only.ts:25-55`) already seeds binding fences
     (`leaseEpoch: 0, routeEpoch: 0`) from `HostJob` without any live
     session — and never invokes live-session `worker.reconcile(record)` on a
     null runtime (`DISPATCH-REPORT.md`). Any pre-persist host refusal logs a
     structured dispatch event before returning the typed error.
3. **Idle build (`idle.ts:46`):** logs `artifact_idle_build_skipped` with
   `reason: "cache_not_prewarmed"` and returns without creating a pod.

This is the only behaviour on an unsealed lockfile — no inline install, no
queueing (§2, D1).

#### 7.1.5 Retention and eviction

`[TARGET]` A sealed unit is retained while (a) a host prewarm with
`refKind: branch|tag` names its `cacheKey` as current for that
(repoId, subPath, workspaces) tuple, or (b) less than 30 days have elapsed
since its last seal or last `requireSealed` hit. A scheduler retention pass
(weekly, builder scheduler) evicts units failing both: archive object
deleted through the key-checked store (`cache-storage.ts:104-108`),
pointer removed, state row set to `absent`, one structured log line
(`artifact_cache_evicted`) per unit. Eviction never touches a unit with an
in-flight job or a warm pool pod (§7.3).

#### 7.1.6 Prewarm internals: what makes sealing itself fast

Prewarm has a soft target (< 15 min p95, consumer §3.3) but the design
prices it at **< 3 min** for the immo lockfile, because four of tonight's
serial costs are artefacts, not physics:

1. **No forge re-download.** The install input is the *manifest closure* —
   root `package.json`, `package-lock.json`, workspace `package.json`
   files — extracted from the snapshot the forge reader already fetched
   for GB1 qualification (`forge-lease.ts:99-108`), not a second download
   of 187 MB. A lockfile containing `file:`/`link:` dependencies pointing
   outside the closure is detected during qualification; only then does
   sealing fall back to the full source unit (§7.2.2), which is downloaded
   once per commit and cached. `forge_redownload` disappears as a step;
   `forge_snapshot` (cache hit ≤ 1 s) replaces it.
2. **Delta tarball fetch, bounded-parallel.** Verified tarballs are stored
   content-addressed by SRI in the cache bucket
   (`tarballs/<sha256-of-integrity>` — fourth admitted key shape) the first
   time any seal fetches them. A new lockfile typically shares most pins
   with its predecessor; only the delta crosses the relay. Fetch runs with
   bounded concurrency 8 (order-preserving admission to the pod stream,
   each still SRI-verified before streaming — the serial generator at
   `cache.ts:131-138` becomes an ordered parallel prefetcher; verification
   order and fail-closed behaviour are unchanged).
3. **No source transfer for install.** Only the manifest closure
   (kilobytes) is staged into `/tmp/install`; `source_transfer` on the
   install path goes to ~0. (Full source staging remains on the *live*
   path, as an archive — §7.2.2.)
4. **No drain.** §7.1.2 replaces it with one in-pod archive stream-out.

Prewarm budget (hard): stall 120 s without step progress, ceiling **15 min**
(new constants beside `deadline.ts:18-28`; the user-path
`INSTALL_CEILING_MS_DEFAULT` becomes unreachable code after §7.1.1 and is
deleted with its env override). A cut seal lands `failed` with
`phase_timeout:seal:<step>`; a retry reuses fetched tarballs and the cached
snapshot, so retries are strictly cheaper than first attempts.

### 7.2 Transfer v2: archives over a pipelined frame channel

#### 7.2.1 Pipelined put frames

`[FACT]` Today each 768 KiB frame is awaited before the next is sent
(`supervisor-channel.ts:90`), so throughput is bound by relay round-trip,
measured ≈ 3.4 MB/s (`deadline.ts:21-23`). `[TARGET]` The channel gains a
pipelined sender: up to **8 put frames in flight**, each still individually
signed and fenced, acknowledged by `(transfer id, frame seq)`; the agent
already writes frames by explicit offset (`supervisor-transfer.ts:63`), so
out-of-order arrival within the window is safe. Frame size is unchanged
(it is sized to the frame byte cap, `supervisor-transfer.ts:10-11`), and
the commit frame still carries the tree digest the agent recomputes.
Abort semantics are unchanged: the watchdog signal rejects every in-flight
frame. The transfer-rate target is a measured gate, not a hope: **≥ 25 MB/s
sustained** API→pod on the preprod relay for a single archive file (Lot 1
gate L1-G). If the gate fails after pipelining, §11 records the decided
fallback (presigned single-object GET by the pod during its offline phase)
and the security review it requires — the sealed-unit format does not
change either way.

#### 7.2.2 Source unit

`[TARGET]` The forge reader keeps the tarball it already downloads for a
snapshot (`forge-lease.ts:61-67`), applies today's path filtering while
repacking it once into a deterministic `tar.zst`, and stores it as
`sources/<commitSha>-<filterDigest>.tar.zst` in the cache bucket.
`source(stagingRef)` then returns the cached unit instead of re-downloading
(`forge-lease.ts:126-133` is replaced; the staged-manifest comparison runs
over the unit's manifest rows, computed at repack time). Live staging
(`worker.stage`, `supervisor.ts:75`) streams the one archive; the agent
extracts to `/workspace` with the §7.2.3 reader and verifies the tree
digest exactly as the commit frame does today. `forge_redownload` and
file-by-file `source_transfer` both disappear; §8 budgets the archive form.

#### 7.2.3 Bounded ustar + zstd reader in the bootstrap agent

`[TARGET]` One shared agent section (`extractArchive`) decompresses `zstd`
(`node:zlib` `createZstdDecompress`) and extracts ustar headers under hard
bounds: regular files only (no links, devices or absolute/`..` paths — the
same refusals as `safeDependencyPath`, `supervisor-transfer.ts:29-37`), modes
restricted to the existing set (`supervisor-transfer.ts:18`), running
counters against `TREE_LIMITS` (`:15`), decompression ratio bound
(refuse past 20:1 or past `totalBytes`, whichever first), streaming
extraction (never the whole archive in memory; the API side already holds
at most one file plus one frame, `supervisor-transfer.ts:52-53`, and the
pod keeps the same discipline). The reader is used for all three units
(source, dependencies, prebundle) and for nothing else; repository archives
are never extracted by it — inputs are only units the builder itself sealed
(§5.2).

#### 7.2.4 Explicit parallel overlap on Cold-known prepare and static build

`[FACT]` Today both `prepareLive` (`prepare-live.ts:34-43`) and `buildOnly`
(`build-only.ts:147-164`) serialize pod creation (`ensureResponsivePod`)
ahead of `forge.snapshot` and `cache.acquire`, and then materialize
`/dependencies`, `/workspace` and `/tmp/vite-cache` strictly one after
another. `[TARGET]` (**D9**, per the consumer §3.1 overlap rule) Cold-known
execution overlaps independent I/O explicitly at two points, both bounded and
recorded in the §7.6.1 phase events:

1. **Snapshot + sealed-cache lookup + S3 stream open in parallel with pod
   bootstrap:** once `requireSealed` admission has succeeded (or as part of
   the same memoized snapshot), `Promise.all` runs `ensureResponsivePod`
   concurrently with opening the S3 `GetObject` read streams for the sealed
   dependency `tar.zst`, the cached source `tar.zst`, and (for live) the
   sealed prebundle `tar.zst`. Metadata verification and S3 TTFB therefore
   finish inside the 3.5–5.5 s pod-bootstrap window rather than adding to it.
2. **Concurrent streaming extraction across the three `emptyDir` mounts:**
   `/dependencies`, `/workspace`, and `/tmp` are separate mounts in the pod
   spec (`pods.ts:80-85`). Before any repository child process spawns, the
   agent permits `extractArchive` to run concurrently on distinct root
   targets (`/dependencies`, `/workspace`, `/tmp/vite-cache`), sharing the
   8-frame pipelined channel window (§7.2.1). Source (~15 MiB compressed) and
   prebundle (~15 MiB compressed) complete alongside dependency extraction
   instead of stacking 4 s + 3 s + 2 s serially.

### 7.3 Warm pod pool: start = attach

`[TARGET]` (consumer §5.2) The builder keeps **at least 1 warm pod per
(tenant scope, hot `cacheKey`)** in preprod and prod. A warm pod is:
created on the `artifact-builders` node pool with the pinned image already
pulled, bootstrap agent up in **unbound** state, `/dependencies` extracted
and frozen from the sealed unit, base source staged at the host-declared
base commit, prebundle unit extracted (§7.4.3), no repository process
running. A live start then performs only: claim + fence binding, overlay
restore, Vite dev start, route ready — the S1 joint budget in §8.

#### 7.3.1 Pool keying and fill

- Pool entries are keyed `(storageScopeId, cacheKey, baseHeadSha)` and held
  in a durable KV namespace `artifact-builder-pool/v1` (same store pattern
  as §7.1.3). "Hot" is declared, not guessed: a successful prewarm with
  `refKind: branch|tag` registers its `cacheKey` as hot for that scope and
  names the base commit; the pool manager (a new step on the existing 30 s
  scheduler tick, `product-builder.ts:33`, plus immediate runs on
  claim/release) reconciles warm count to the configured minimum
  (`ARTIFACT_POOL_MIN_PER_HOT_KEY`, default 1, env-validated name-only like
  the other builder settings).
- Fill runs the existing prepare sequence minus session binding:
  create pod → concurrently extract sealed dependencies (`tar.zst`), stage
  source unit at `baseHeadSha` (`tar.zst`), and extract sealed prebundle unit
  (or run `PREBUNDLE_RECIPE` under yielding heavy admission if absent) → mark
  `warm` with `{podName, podUid, poolEpoch, cacheKey, baseHeadSha, filledAt}`.
  Pod creation takes a pod slot (§7.3.4). Because worker pods enforce a
  30-minute liveness lease (`LIVENESS_LEASE_MS`, `bootstrap-frame.ts:14`,
  `:90-95`; checked every 60 s at `bootstrap-server.ts:121-123`), the pool
  manager sends a fenced `renew` frame at least every 60 s to every `warm`
  and `warm-deps` pod so idle pool pods never self-terminate with exit code 3.
- If the binding head has moved past the warm pod's `baseHeadSha` at claim
  time, the pod is still claimable when the new head is a fast-forward and
  the draft is clean — source is restaged from the (cached) source unit
  and the prebundle unit is re-validated by Vite metadata, exactly the
  rules `prepareLive` already applies to head movement
  (`prepare-live.ts:23-28`). Otherwise the claim falls through to the
  cold-known path and the pod returns to the pool for refill at the new
  base.

#### 7.3.2 Claim: physical/logical pod identity split and `poolEpoch` fence (scoped)

`[FACT]` A pod name cannot change after creation, and today the pod name
*is* the binding hash (§4.3), so a pod pre-created before its binding is
known cannot take the deterministic name. `[DECISION]` (**D10**) Split the two
meanings and extend the pod fence for multi-cycle pool lifetime:

- `bindingLabel(key)` (already a separate export, `pods.ts:9`) becomes the
  **logical** identity everywhere storage rows are keyed today by
  `podName(key)`: `remote-drafts.ts`, `remote-live.ts`, `forge-binding.ts`
  (listed in §4.3). Row key values are unchanged strings — `podName(key)`
  is `artifact-<bindingLabel>`, and the row functions switch to the label
  form in one mechanical change with a dual-read release for rows written
  under the old form.
- `LiveRuntime.podName` becomes the **physical** pod name, assigned at pod
  creation or pool claim (`revive.ts:27` and `build-only.ts:111` stop
  deriving it from the key; `builderPod`'s name check at `pods.ts:54` and
  `liveViteConfig`'s regex at `recipes.ts:96` both admit
  `/^artifact-(?:[a-f0-9]{40}|pool-[a-f0-9]{16})$/`). Pool pods are named
  `artifact-pool-<16-hex>`; session-created pods keep the deterministic
  40-hex name (unchanged behaviour on the cold-known path).
- All consumers that recompute the name from the key are switched to the
  stored runtime value: `heavy.ts:106` (holds seeding),
  `controller.ts:142` (heavy status). Heavy-queue subjects, supervisor
  frames and the Kubernetes Service already address `runtime.podName`
  (`pods.ts:226-250`, `supervisor-channel.ts:70`), so the change is
  contained to the files listed in §10.
- **Monotonic `poolEpoch` fence (`bootstrap-frame.ts:22-25,54-60`).** Today
  `frameFence` requires `(generation, leaseEpoch, routeEpoch)` to never
  decrease over a pod's lifetime, which would reject claiming a scrubbed pod
  for a newer artifact whose `generation` (`1`) is smaller than the previous
  occupant's (`5`). `FRAME_OPS` adds the closed ops `claim`, `scrub`,
  `sealDependencies`, `extractArchive` and `applyOverlay`, and the fence gains
  `poolEpoch` (integer ≥ 0; `0` for non-pool session pods). Ordering becomes
  lexicographic over `(poolEpoch, bound ? 1 : 0, generation, leaseEpoch,
  routeEpoch)`: fill and idle `renew` run at `(poolEpoch: k, bound: 0, 0, 0,
  0)`; `claim` transitions `(poolEpoch: k, bound: 0 → 1)` and installs the
  claimed artifact's `(generation, leaseEpoch, routeEpoch, sessionId)`;
  `scrub` advances to `(poolEpoch: k + 1, bound: 0, 0, 0, 0)`, invalidating
  every frame from epoch `k` permanently while allowing epoch `k + 1` to bind
  to any artifact generation ≥ 0.

**Claim protocol** (fenced agent op `claim` + builder steps):
1. `revive`/`wake` ask `pool.claimForLive(scope, cacheKey, baseHeadSha)` for
   a `warm` pod before taking a pod slot; `buildOnly` asks
   `pool.claimForBuild(scope, cacheKey)` for a `warm` **or** `warm-deps` pod
   (static builds stage `job.commitSha` directly and do not use `/tmp/vite-cache`).
   On a hit, the pool row flips `warm|warm-deps → claimed` under
   compare-and-swap with the new fences; a concurrent second claim misses
   cleanly to cold-known.
2. The builder patches the pod labels to the binding/session/lease set
   (`pods.ts:11-16` — needs the new `patchLabels` Kubernetes port method,
   §7.3.5), creates the Service under the physical name (existing ensure
   logic, live path only), and sends one signed `claim` frame carrying the
   full fence (`poolEpoch`, `sessionId`, `generation`, `leaseEpoch`,
   `routeEpoch`, `podName`, `podUid`). Before `claim`, an unbound pool agent
   accepts only pool-fill ops and `renew` at `bound: 0`; after the claim ACK,
   the pod is indistinguishable from a session-created pod.
3. `prepareLive` on a claimed `warm` pod skips pod creation, dependency
   extraction and (when the base matches) source staging and prebundle;
   it runs overlay restore and dev start only. `buildOnly` on a claimed
   `warm` or `warm-deps` pod skips pod creation and dependency extraction,
   stages only the committed `source` `tar.zst`, and runs `BUILD_RECIPE`.
   Each skipped step is recorded in phase events as `pool: warm-hit` (or
   `warm-deps-hit`) so case tagging (§7.6.2) is server-derived.

**Two-stage release (`warm-deps → warm`).** Teardown (`transitions.ts:43-78`)
and static-build completion (`build-only.ts:212-218`) gain a pool branch:
after quiesce, instead of deleting the pod, the agent runs `scrub` — terminate
the whole process tree (existing `terminateAll` discipline), clear
`/workspace` and `/tmp`, verify `/dependencies` remains intact and frozen at
`0444/0555` when its sealed `cacheKey` still matches a hot key for the same
scope, and advance `poolEpoch` to `k + 1` (`bound: 0`). The builder verifies
the scrub ACK (`cleared` set must equal `['/workspace', '/tmp']`, the pattern
already used at `supervisor-install.ts:26-28`), deletes the Service, unlabels
the binding labels, and **synchronously marks the pod `warm-deps`** before
`stop` answers (fitting inside S4's 1.5 s p95 / 4 s max budget, so an
immediately following S5 `git_publish` in the same S6 workflow can claim the
hot `/dependencies` tree without cold pod creation — matching consumer §7.2's
explicit lifecycle note). Background refill then stages `baseHeadSha` source +
prebundle to promote `warm-deps → warm`. **Any scrub doubt deletes the pod**
(§5.5). Pods are never reused across storage scopes, even for an identical
lockfile: the pool key includes the scope, and a claim for another scope
cannot match by construction. Maximum pod age in pool: 24 h, then delete
and refill (bounds image/agent drift).

#### 7.3.3 Exhaustion, and the acceptance drain control

`[TARGET]` Pool exhaustion degrades to Cold-known (pod creation), never to
an install and never to an untyped wait: if neither a warm pod nor a pod
slot is obtainable inside the S1 joint max, the start fails typed
`pool_exhausted` (`retriable: true`) — replacing today's generic `queued`
after up to 600 s (`heavy.ts:85-88`) on the start path. For consumer §7.2
cold-known campaigns, the builder exposes `POST /v1/pool/drain` (S2S,
refused unless `ARTIFACT_POOL_ADMIN=1`, preprod only by configuration):
deletes **every unbound pool pod (`warm`, `warm-deps`, `filling`)** for the
caller's scope without touching sealed units, waits for their Kubernetes 404,
and returns the pre-drain occupancy + timestamp, which the acceptance report
records as the per-run cold proof.

#### 7.3.4 Quota dependency (k8s lane)

`[FACT]` Warm pods book the same 1536 Mi request as active pods
(`pods.ts:77-78`) and the tenant quota admits 2 (`service.ts:36`). One
warm + two active therefore needs **4 pod slots** (one spare for a
build-only pod): namespace `requests.memory` 3 Gi → 6 Gi and
`MAX_BUILDER_PODS` 2 → 4, node pool already autoscales
(`pods.ts:75-76`). This is a hard dependency of Lot 3 on the k8s lane,
sized in §9; without it the pool minimum silently becomes zero, which the
pool metrics surface as an alert (§7.6.3) rather than a hidden state.
Idle warm pods cost ~19 MiB actual (measured pod base,
`product-builder.ts:36`) — the quota cost is scheduler booking, not
consumption; in-pod vertical resize is out of scope (§11).

#### 7.3.5 New Kubernetes port surface

`KubernetesCore` (`pods.ts:175-181`) gains `list(labelSelector)` and
`patchLabels(name, uid, labels)` — both namespace-confined through the
existing in-cluster client, both fenced by uid like `delete`. The pool
manager lists `sentropic.dev/pool=artifact-builders` pods at startup to
re-adopt survivors after an API restart (§7.5.4) and cross-checks the KV
pool rows; a pod present in Kubernetes but absent from the pool rows (or
the reverse) is deleted as an orphan, logged, and counted.

### 7.4 Incremental build on the installed live tree

#### 7.4.1 Fast projection: writes ride the running Vite server

`[TARGET]` While a session is `LIVE`, a `live_write` no longer
re-projects. The package still persists the overlay durably first
(unchanged, `live-mutations.ts:29-41`); the builder then applies it to the
running pod through a new path in `projectRevision`:

1. Classify touched paths. **Source-only** (anything except
   `package.json`, `package-lock.json`, `vite.config.*`, and the
   host-owned config inputs) → fast path. Config/dependency paths → the
   existing full re-projection (`project.ts:29-42`), including a
   `cache_not_prewarmed` check when the lockfile changed.
2. Fast path: one fenced `applyOverlay` supervisor op writes each file
   atomically (temp file + rename inside `/workspace`, deletes applied
   after writes), then the agent requests each touched module from the
   local Vite server (loopback :5174, the port the bootstrap already
   proxies, `recipes.ts:65-70`) and waits until every touched module
   transforms successfully or the first typed transform error. The op ACK
   carries `builtRevision` = a hash of the served module ETags plus the
   applied draft revision. Only then does the builder set
   `appliedRevision` — the session phase **stays `LIVE`, the route is
   never revoked** on this path.
3. Failure is typed `vite_transform_failed` with the scrubbed bounded Vite
   tail as log-only detail (same discipline as recipe diagnostics,
   `deadline.ts:220-224`); `appliedRevision` does not advance, the durable
   overlay is not rolled back (the next write fixes it), and the caller
   sees the typed failure instead of a fake success. A dead Vite process
   (probe failure) falls back to full re-projection once, then to the
   §7.5 crash-restore rules.

The package-side `workerPending` contract is unchanged in shape: the
write response carries `appliedRevision` and, on the fast path,
`builtRevision`, which is what the conductor polls the preview for
(consumer §5.3 "visible" = the preview serves the new asset content; the
preview proxy passes Vite's ETags through, so the hash is externally
checkable without a new endpoint).

#### 7.4.2 What stays full-price, explicitly

`live_reset`, head movement with a dirty draft, wake from a stopped
session, and any write touching configuration or the lockfile keep today's
re-projection semantics. They are not inside S2 (consumer S2 is one small
content write on a warm session), and §8 does not budget them as fast.

#### 7.4.3 Sealed prebundle unit (default-on in prewarm; keeps Cold-known inside its joint budget)

`[FACT]` Pre-bundle output (`/tmp/vite-cache/deps/_metadata.json` and the
optimized deps) is produced per pod today via `PREBUNDLE_RECIPE` (which also
consumes a 980 MiB heavy-phase slot, `product-builder.ts:37`) and thrown away
with the pod (`recipes.ts:71-90`); its duration on the immo tree is
`unverified` — no retained measurement. `[TARGET]` (**D11**) By default
(`"prebundle": true`, default `true` in `POST /v1/cache/prewarm`), the
prewarm job continues immediately after sealing `/dependencies` in the same
pod: stage the source unit at the trigger commit, run `PREBUNDLE_RECIPE`, and
seal `/tmp/vite-cache` as a third `tar.zst` unit keyed
`(cacheKey, baseTreeSha, viteConfigDigest)` (`artifact-builder-cache/v1/<lockSha>/<keySha>/prebundle-<digest>.tar.zst`).
Cold-known `prepareLive` extracts it concurrently beside `/dependencies` and
`/workspace` (§7.2.4) and **skips `PREBUNDLE_RECIPE` (and its heavy-queue
turn)** whenever the key matches; Vite's own `_metadata.json` check decides
reuse (a `vite.config.*` edit in the overlay simply falls back to
`PREBUNDLE_RECIPE`, degrading to today's behaviour rather than an error). The
cache state query reports `prebundleState: "sealed" | "skipped" | "failed"`
as a sub-field of the sealed entry. Lot 4 still measures raw uncached
`PREBUNDLE_RECIPE` duration in preprod (gate L4-G) to bound the config-edit
fallback, while default-on prebundle sealing removes that cost from standard
Cold-known starts.

### 7.5 Dispatch reliability and the edge contract (zero silent failures)

This section closes consumer §3.4/§5.4/§5.5 and the proven immo dispatch
defect. Ownership follows the current split — package LiveService in the
host process, controller in the builder — and every mechanism below is
observable from the other side.

#### 7.5.1 Package settle: awaited first attempt, logged, exported

`[TARGET]` In `@sentropic/artifacts`:

- `settleLiveWorker` (`packages/artifacts/src/server/live-worker.ts:6-43`)
  stops swallowing. `LiveServiceDeps` gains a required-in-qualified-
  composition `log(event)` port (structured fields: artifact id, operation,
  phase, typed code, invocation id — consumer §3.4 minimum). Every settle
  failure logs **before** returning, with the worker error code unchanged;
  the bare `catch {}` at `live-worker.ts:42` is deleted, and a lint/test
  grep gate forbids `catch {` without a log call in `live-service.ts`,
  `live-worker.ts` and `live-commit.ts`.
- The worker client logs every non-2xx builder answer with its HTTP status and
  parsed refusal `{code, reason, retriable}` instead of collapsing every
  non-200 status into `provider_unavailable`
  (`packages/artifacts/src/live-host/worker-client.ts:112-139`): tonight's
  single unknown (the exact draft-staging status, §3) becomes a logged
  field on both sides — the builder's host-live handlers already refuse
  through one `refusal()` mapping (`host-live-api.ts:98-115`), which gains
  the matching structured line (`artifact_live_dispatch_failed` with route,
  status, code).
- First dispatch is **awaited, bounded**: `live-service.ts:163-167` awaits
  the settle for every action under the reconcile wait the builder already
  honours (25 s product value, `product-builder.ts:41`; client timeout
  30 s, `worker-client.ts:137`). On an initial `DORMANT → REVIVING` start
  rejected with `cache_not_prewarmed` (§7.1.4), the awaited settle rolls
  `record.runtime` back to `DORMANT`, clears the unfulfilled start receipt,
  and rethrows `cache_not_prewarmed` (≤ 5 s). Otherwise the response reports
  the exact post-attempt state: `LIVE` with `appliedRevision` when the ACK
  landed; `REVIVING` with `workerPending: true` and
  `lastDispatchError: {code, retriable}` when a retriable transient failure
  occurred. `live-commit.ts:110` gets the same awaited treatment. Awaiting
  changes no acceptance semantics for retriable intents: the durable intent is
  still written first (`live-mutations.ts:55-69`), so a caller disconnect
  after acceptance loses nothing — §7.5.2 owns the intent from there.
- `settleLiveWorker` and a new `redriveLiveWorkerOnce` are exported (new
  subpath `./server/live-worker` in package exports) so hosts can compose
  the scanner below. This is the exact missing surface the immo report
  names (§4.5).

#### 7.5.2 Re-drive scanners, retry budget, terminal typed failure

`[TARGET]` Two scanners, because intents live on two sides:

**Package/host scanner.** A new store port `listWorkerPending(limit)`
returns draft records with `appliedRevision !== revision` in phases
`REVIVING | QUIESCING` (the durable shape already exists,
`live-mutations.ts:71-72`; adapters implement it over the existing draft
store — no new table). The package ships `createLiveRedriveScanner({store,
deps, intervalMs: 15_000, log})`; each pass re-runs one settle attempt per
pending record (project or stop according to phase). Hosts start it in
composition next to the timers they already run; the Sentropic host
composition and the immo host both wire it (Lot 2 names both). Retry
policy per intent, persisted on the runtime record (`dispatchAttempts`,
`nextDispatchAt`, `lastDispatchError`): exponential backoff 5 s → 120 s,
**5 attempts within ≤ 5 min**, then a **typed terminal failure**:
phase `DORMANT`, `stateDetail: dispatch_failed:<last code>`,
`workerPending: false`, binding lock released, readable via `live_status`.
A `cache_not_prewarmed` outcome is terminal immediately (retrying cannot
seal a cache) but does not consume the attempt budget — the next start
after sealing proceeds normally.

**Builder scanner.** The existing 30 s scheduler
(`scheduler.ts:28-33`) gains three passes over durable builder state:
1. *Revive resume*: a `REVIVING` runtime with no in-process driver (a new
   in-process registry of keys currently inside `prepareLive`/`buildOnly`)
   and no phase progress for > 120 s is re-driven once — fenced teardown
   of any half-prepared pod, then a fresh `prepareLive` under a
   crash-restore counter (max 2 automatic resumes, the bound already used
   for crash restores, `revive.ts:45-55`), then terminal typed failure via
   the existing `failed()` teardown (`transitions.ts:89-95`). The
   controller's `probe === 'active' → return` early-exit
   (`controller.ts:68`) is removed for runtimes with no live driver: an
   active pod with no driver is precisely the post-restart orphan.
2. *Build-job resume*: an `accepted` job older than 60 s with no driver is
   re-run with its persisted token (`build-jobs.ts:16-18`, `:44-49` make
   double-completion safe). This replaces the 90 min stale window as the
   recovery mechanism; `runStaleMs` stays only as the re-admission guard.
3. *Prewarm resume*: a `building` cache job whose heartbeat is stale
   (> 180 s) is resumed from its recorded step (fetched tarballs and the
   cached snapshot are content-addressed, so resume skips them; an install
   pod whose tarballs are already staged resumes at `recipe`), or failed
   typed `builder_restarted` (`retriable: true`) and auto-retried once.

Idempotency is preserved end to end: command receipts
(`live-service.ts:79-90`), the reconcile serial lane
(`host-live-api.ts:34-46`) and job tokens already make a repeated attempt
safe; the scanners add attempts, never new sessions.

#### 7.5.3 Total stop, orphan teardown, repeated start joins

`[TARGET]`
- **Repeated start joins**: `live_control(start)` on a `REVIVING` record
  (any origin) returns the current state and triggers one immediate
  awaited settle attempt; `active_session` (`live-mutations.ts:52`) is
  reserved for a `LIVE` session owned by a different live session id.
- **Total stop**: for any non-terminal runtime, `stop` either reaches
  `DORMANT` inside S4 or returns a typed code naming the blocker.
  Concretely: the builder bridge stop becomes idempotent — an unknown or
  already-dormant session at the exact binding generation answers 204
  (today `controller.ts:117-127` conflicts `stale_session` when the
  runtime row is absent); the package, on `provider_unavailable` from
  `worker.stop`, records `QUIESCING` + pending stop intent and lets
  §7.5.2 finish it instead of surfacing `invalid_request`; `QUIESCING`
  older than 10 min is force-settled to `DORMANT` after the builder
  confirms no pod (probe) or completes `recover()`
  (`controller.ts:18-29`).
- **Orphan teardown**: builder-side, runtimes in `REVIVING | QUIESCING`
  with no pod and no progress for > 10 min are torn down by the scanner
  (extending today's probe-based teardown, `controller.ts:61-70`) with
  `stateDetail` set, binding released, counted in §7.6. Package-side, the
  §7.5.2 terminal transition is the mirror guarantee; a host `stop` on
  such a terminal record answers success (`already stopped`), never
  `invalid_request`.
- Pod death mid-session keeps today's crash-restore
  (`controller.ts:43-50`, `revive.ts:49-55`) with the draft preserved; the
  scanner bounds total time in non-terminal states to the §8 fault
  budgets.

#### 7.5.4 Resume after API restart, and drain-safe deploys

`[FACT]` Everything in-flight on the builder side (install streams, build
runs) is process memory today (§4.5); the durable rows survive but nothing
re-drives them, and the heavy queue already re-seeds its holds from the
store at first use (`heavy.ts:33-41`, `:104-107`) — proof the re-adopt
pattern works here. `[TARGET]` Restart behaviour is specified as resume,
not hope:

- On boot the builder runs one adoption pass before accepting traffic:
  seed heavy holds (existing), re-adopt pool pods (§7.3.5), then let the
  §7.5.2 scanners pick up every non-terminal intent. Readiness
  (`builderReady`) flips only after adoption completes; until then the
  mount answers 503 `builder_unavailable` — the existing graceful-refusal
  shape (`product-builder.ts:79-89`).
- Deploys become drain-safe (k8s lane + builder composition): the
  composition exposes `drain()` — stop admitting new builder POSTs with
  503 `builder_draining` (`retriable: true`), finish in-flight drivers up
  to a 120 s grace, then exit. Deployment settings: rolling update with
  `maxUnavailable: 0`, `terminationGracePeriodSeconds ≥ 150`, `preStop`
  calling the drain hook. User-path operations after Lot 1 are ≤ 60 s by
  SLO, so the grace covers them; prewarm jobs may exceed it and rely on
  §7.5.2 resume — by design, not by accident.
- Net guarantee, testable as consumer F2: an API restart at any point
  between acceptance and `LIVE`/`published` ends in the same terminal
  state as no restart, within S1 max + one re-drive interval (≤ 60 s),
  with no duplicate session, commit or publication.

#### 7.5.5 Edge contract: no 502 on an operation that succeeds

`[TARGET]` Rule: **no synchronous builder or package operation runs longer
than 25 s server-side.** Everything already async stays async (builds:
202 + `GET /v1/builds/:artifactId/:jobId`, `host-build-api.ts:69-76`;
reconcile: `ready: false` inside the wait, `host-live-api.ts:47-56`).
The two operations observed returning Cloudflare 502 while landing later
(`live_write`, `git_commit`) become *accept-then-poll* at the package
boundary:

- `live_write` returns after the durable overlay persist + the awaited
  settle attempt (§7.5.1). On the fast projection path that attempt is
  budgeted at 10 s; past it, the response is a successful **acceptance**:
  `{state: "REVIVING"|"LIVE", workerPending: true, revision,
  invocationId}` and the outcome is read through `live_status`, which
  gains `lastCommand: {invocationId, operation, state, appliedRevision,
  builtRevision?, error?}` sourced from the existing command receipts
  (`live-service.ts:79-90`) plus runtime state. The first call's outcome
  is therefore never `unknown`: it is either in the response or in the
  next status poll under the caller's own idempotency key.
- `git_commit` attempts synchronously under a 20 s internal budget; past
  it, it returns the existing pending-commit shape (`pendingCommit` is
  already a first-class record state, refused as `commit_indeterminate`
  for conflicting writers at `live-mutations.ts:24`) with the invocation
  id, and `live_status` reports the commit outcome when the forge call
  lands. Retrying with the same idempotency key rejoins the same commit
  (existing receipt rule) — never a second commit.
- Client timeouts are aligned above server budgets, not below them:
  page/seal/stop stay small and fast server-side (< 5 s; they write
  bounded pages, `host-live-api.ts:98-115`), client default rises 10 s →
  15 s for margin (`worker-client.ts:112`); reconcile stays 30 s over a
  25 s server wait. Sentropic's own Traefik ingress carries no per-route
  timeout annotations today (`deploy/k8s/overlays/preprod/ingress.yaml`);
  the k8s lane records the configured gateway timeout per builder route
  in the acceptance report and sets it **above 60 s** as a backstop
  (consumer §5.7) — but the backstop is not load-bearing: with the 25 s
  server rule, a gateway that times out at 30 s still cannot mask a
  success, because no success needs longer than 25 s to answer.

### 7.6 Per-phase metrics, SLO aggregation and alerts

#### 7.6.1 Phase events: persisted, per invocation, 30-day retention

`[TARGET]` The two existing log emitters become dual emitters: in addition
to the `artifact_live_phase` / `artifact_live_install_step` lines
(`deadline.ts:171-182`, `:210-224`), `runPhase` and `runInstallStep` write
one durable event per phase/step to a `PhaseEventSink`, stored as one KV
row per invocation (`artifact-builder-phase-events/v1`, JSON array of
bounded entries — an invocation has ≤ ~30 phases) plus a per-day index row
listing invocation ids. Event fields (closed set):

```
{ invocationId, artifactId, storageScopeId (hashed in logs, plain in-row),
  operation: live_start|live_write|git_commit|stop|git_publish|prewarm,
  case: warm|cold-known|cold-new-lockfile, lockSha256?, cacheKey?,
  cacheState?, pool?: warm-hit|claimed|miss|exhausted,
  phase, step?, at, ms, outcome: ok|fail, code?, reason?, attempt }
```

Phase names map 1:1 onto the consumer §2 events: `start_accepted` (package
receipt written / builder reconcile received), `pod_ready` (responsive pod
or claim ACK), `cache_ready` (`requireSealed` ok, with cache state),
`preview_routable` (`routes.ready`, the last line of `prepareLive`,
`prepare-live.ts:56`), `build_started`/`build_finished` (heavy `build`
phase, `build-only.ts:166-167`), `bundle_published` (handoff receipt
recorded, `build-jobs.ts:56-62`). `url_routable` is emitted host-side when
the published URL first answers 200 (the builder cannot observe it); the
SLO computation joins both under `invocationId`, and a missing
`url_routable` inside 60 s of `bundle_published` is itself an alertable
gap. Package-side events (accept, dispatch attempts, terminal failures)
ride the same sink interface via the host composition; the builder stores
what it emits, the host stores what it emits, and `/v1/slo` (below) reads
the builder store — the acceptance campaign reads both stores under the
same invocation ids. Retention 30 days via the retention pass of §7.1.5;
rows carry no secrets (§5.6). A phase that ends without its event (sink
write failure) increments `phase_event_write_failures` and logs — a
missing measurement is a visible defect, never a silent zero.

#### 7.6.2 Case tagging is server-derived

Per-operation `case` is stamped inside the builder at run time (client-asserted
cases are ignored): `warm` = sealed hit + pool claim (`warm-hit` or
`warm-deps-hit`), `cold-known` = sealed hit + pod created (`pool: miss`),
`cold-new-lockfile` = sealed miss (`cache_not_prewarmed`), per consumer §2.
For end-to-end S6 aggregation (`s6Joint` in `/v1/slo`), an S6 workflow's case
(`warm` vs `cold-known`) is determined by its S1 `live_start` event's
server-derived `case` (and, in the §7.2 campaign, cross-checked against the
preceding `POST /v1/pool/drain` receipt): during a Cold-known S6 run, S1 runs
at `pool: miss` (`case: cold-known`), S4 releases that pod to `warm-deps`
(§7.3.2), and S5 claims it (`pool: warm-deps-hit`), matching consumer §7.2's
rule that the released pod becomes reusable at `stop` and the pool is drained
again before the next run's S1. Standalone static `git_publish` runs with zero
pool pods at admission stamp `case: cold-known` (`pool: miss`) on S5 and are
judged against the standalone S5 budget (< 25 s p95, < 60 s max).

#### 7.6.3 Endpoints and alert rules

```
GET /v1/metrics/phases?artifactId=...&invocationId=...   raw events
GET /v1/slo?window=24h&case=warm|cold-known
  -> { phases: { S1: {n, p50, p95, max, breaches}, ... , S6: {...} },
       cache: { sealed, building, failed, notPrewarmedRejections },
       pool:  { warm, claimed, exhaustionEvents },
       dispatch: { attempts, redrives, terminalFailures, orphansReaped } }
GET /v1/pool    occupancy per (scope, cacheKey): warm|claimed|filling counts
```

Percentiles use the consumer-fixed nearest-rank method
(`ceil(0.95 × N)`, consumer §3.2); below 20 samples the endpoint returns
`p95: null, insufficientSamples: true` rather than a number. S6 is computed
from `start_accepted` (attach) to `url_routable` joined events where both
exist; the joint-allocation verdict per run (each step inside its joint
max) is returned as `s6Joint: {runs, passes, failures[]}` so the conductor
dashboard (consumer §6.4) renders verdicts, not arithmetic.

Alert rules — emitted as structured log lines `artifact_slo_breach` from a
scheduler pass every 5 min (delivery wiring to the ops channel is the k8s
lane's, Lot 6; the builder's contract stops at the emitted line plus the
`/v1/slo` state):
- any single run ≥ a phase max, or S6 ≥ 60 s;
- p95 over target on a rolling 24 h window with ≥ 20 samples;
- **any silent failure**: a terminal failure with no phase event, or
  `phase_event_write_failures > 0`, or a dispatch attempt with no log line
  (counters make the absence countable);
- `cache_not_prewarmed` rejections > 0 (a host trigger was missed);
- warm pool count 0 for a hot key for > 5 min; `pool_exhausted` events;
- any runtime non-terminal for > 10 min (orphan detector over the same
  rows the scanner reaps);
- client-vs-builder duration discrepancy > 2 s (consumer §3.2) once host
  events are joined.

### 7.7 What does not change

The A-LIVE fence model, draft encryption and overlay persistence, GB1
qualification, the heavy-phase queue and its memory accounting, the
candidate/handoff publication flow, invitation fencing and the content
relay are untouched except where §7 names a file. In particular §7.3.2's
identity split and §7.4.1's fast projection are additive paths behind the
existing fallbacks: with pool minimum 0 and fast projection disabled by
configuration, behaviour reduces to Lot 1 + Lot 2 semantics — which is
also the rollback shape (§11).

---

## 8. Budgets: measured today → target, summing under 60 s

### 8.1 Install/seal steps (user path after Lot 1: only `cache_lookup` remains)

| Step | Measured 2026-11-11 (cold, on user path) | After this spec | Where |
| --- | --- | --- | --- |
| `cache_lookup` | 3–8 ms | ≤ 0.2 s p95, 5 s hard bound | user path (`requireSealed`) |
| `heavy_admit` (install) | 6–18 ms | 0 (no install phase) | — |
| `forge_redownload` | 21–23 s | 0 user / `forge_snapshot` ≤ 1 s hit | prewarm only |
| `source_transfer` (install) | 35–41 s | ~0 (manifest closure) | prewarm only |
| `tarball_stream` | 108–112 s | 0 user / delta + parallel, ≤ 30 s | prewarm only |
| `recipe` (`npm ci`) | 30 s | 0 user / ≤ 60 s | prewarm only |
| `drain` | > 999 s (cut) | **eliminated** — `seal_archive` ≤ 30 s | prewarm only |
| `cache_admit` | (≤ 120 s bound) | ≤ 2 s (one object + pointer) | prewarm only |
| Seal total (first time, immo lockfile) | ≥ 20 min ceiling | **≤ 180 s target, 15 min hard** | out of band |

### 8.2 S1 decomposition (builder-internal sub-budgets inside the consumer joint line)

| Sub-step | Warm p95 | Warm max | Cold-known p95 | Cold-known max |
| --- | --- | --- | --- | --- |
| Dispatch: draft stage + reconcile + `requireSealed` admit | 0.9 s | 2.0 s | 0.9 s | 2.0 s |
| Pod: claim (`warm`) / create + bootstrap ready (`Promise.all` with S3 stream open, §7.2.4) | 0.5 s | 1.0 s | 3.5 s | 5.5 s |
| Concurrent `tar.zst` transfer + streaming extract: `/dependencies` + `/workspace` + `/tmp/vite-cache` (already extracted on Warm / §7.2.4 parallel mounts on Cold-known) | 0.3 s | 1.0 s | 4.8 s | 7.5 s |
| Overlay restore (initial start overlay) | 0.4 s | 0.5 s | 0.4 s | 0.5 s |
| Vite dev start → serving (reusing extracted `/tmp/vite-cache` prebundle unit, §7.4.3) | 1.8 s | 3.0 s | 1.8 s | 3.0 s |
| Route ready (`preview_routable`) | 0.3 s | 0.5 s | 0.4 s | 0.5 s |
| **S1 internal sum** | **4.2 s** | **8.0 s** | **11.8 s** | **19.0 s** |
| Consumer budget | p95 < 30 s (S1), joint 15 s | 45 s, joint max 20 s | p95 < 30 s (S1c), joint 15 s | < 60 s, joint max 20 s |

Read against the consumer §3.1 joint allocation strictly: **both Warm (4.2 s
p95 / 8.0 s max) and Cold-known (11.8 s p95 / 19.0 s max) fit inside the
15 s joint p95 and 20 s joint max lines without borrowing margin from other
steps.** Three explicit mechanisms keep Cold-known inside 15 s / 20 s:
(1) overlapping S3 `GetObject` stream setup with `ensureResponsivePod`
(`Promise.all`, §7.2.4), (2) `zstd` streaming extraction concurrently across
the three independent `emptyDir` mounts (`/dependencies`, `/workspace`,
`/tmp/vite-cache`, §7.1.2 + §7.2.4), and (3) default-on prebundle sealing in
prewarm (`prebundle: true`, §7.4.3) so Cold-known skips `PREBUNDLE_RECIPE` and
its heavy-queue turn. Because pod-create and `tar.zst` extract durations are
`unverified` until preprod hardware measurements at gates L1-G/L3-G/L4-G, §11
binds the pre-decided acceleration chain (`8 → 16` frame window, then
presigned single-object S3 GET `F-T1`) if L1-G exceeds the 4.8 s p95 / 7.5 s
max extract line.

### 8.3 End-to-end S6 and S5 static build (all steps within joint maxima, total < 60 s)

| Step | Joint p95 (consumer) | Warm p95 | Cold-known p95 | Joint max (consumer) | Warm max | Cold-known max |
| --- | --- | --- | --- | --- | --- | --- |
| attach (host) | 2 s | 1.0 s | 1.0 s | 3 s | 2.0 s | 2.0 s |
| S1 live start → LIVE | 15 s | 4.2 s | 11.8 s | 20 s | 8.0 s | 19.0 s |
| S2 live_write → visible | 3 s | 1.8 s¹ | 1.8 s¹ | 5 s | 4.0 s | 4.0 s |
| S3 git_commit | 5 s | 3.0 s | 3.0 s | 7 s | 6.0 s | 6.0 s |
| S4 stop (`warm-deps` scrub ACK) | 3 s | 1.5 s² | 1.5 s² | 5 s | 4.0 s | 4.0 s |
| S5 git_publish → url_routable | 12 s | 7.8 s³ | 8.0 s³ | 15 s | 13.0 s | 13.0 s |
| **S6 Total** | **40 s** | **19.3 s** | **27.1 s** | **55 s (< 60 s hard)** | **37.0 s** | **48.0 s** |

¹ Overlay apply 0.5 s + Vite transform of touched modules 1.0 s + ACK/poll
0.3 s (§7.4.1; no route flap, no re-projection).
² Two-stage pool release (§7.3.2): `terminateAll` + `scrub` (`/workspace` and
`/tmp` wiped, `/dependencies` kept frozen, `poolEpoch` incremented) + Service
delete + synchronous `warm-deps` mark ≤ 1.5 s p95 / 4.0 s max; background
refill (`warm-deps → warm`) runs asynchronously after `stop` answers.
³ S5 inside S6 (`claimForBuild`, §7.3.2): synchronous `requireSealed` + job
admit 0.3 s (0.8 s max), claim `warm` or `warm-deps` pod (in §7.2 Cold-known,
the pod created in S1 and scrubbed to `warm-deps` in S4) + committed-head
source `tar.zst` stage 1.0 s (1.7 s max), clean Vite `BUILD_RECIPE` of the
§10 small artifact 4.0 s (6.0 s max), dist snapshot + candidate handoff +
host receipt 2.0 s (3.3 s max), `url_routable` 0.5 s (1.2 s max) = **7.8–8.0 s
p95 / 13.0 s max** (joint budget: 12 s p95 / 15 s max). For a **standalone
Cold-known S5** on an attach-only static artifact with zero pool pods at
publish admission (`pool: miss`), `buildOnly` overlaps `ensureResponsivePod`
(3.5 s p95 / 5.5 s max) with `requireSealed` + S3 stream open, extracts
`/dependencies` + `/workspace` concurrently (4.2 s p95 / 6.5 s max), runs
`BUILD_RECIPE` (4.0 s / 6.0 s), and publishes (2.3 s / 4.5 s) = **14.3 s p95
/ 22.8 s max**, well inside the standalone S5 SLO (< 25 s p95, < 60 s max,
consumer §3.1). The heavy `build` phase cost (1370 MiB, one at a time,
`product-builder.ts:37`) is a queueing risk under concurrency, not a latency
term for a single run; queue wait is recorded as a phase event (§7.6.1).

### 8.4 Fault budgets (consumer §7.4)

| Fault | Bound after this spec |
| --- | --- |
| Pod killed mid-start (F1) | LIVE or typed terminal ≤ S1 max (45 s) + 60 s re-drive interval |
| API restart mid-start (F2) | Same bound; resume via §7.5.2, no duplicate session |
| Pod death mid-session (F3) | Crash-restore with draft preserved, or typed terminal; no orphan > 10 min; stop always settles |
| Edge timeout pressure (F4) | No 502-masking: sync ops ≤ 25 s; outcomes via response or `live_status` poll |
| Prewarm sealing | < 180 s target / 15 min hard, step-visible throughout |

---

## 9. Lots, ordered by value toward < 60 s

Ordering rule: the first lot removes the largest measured term from the
user path (≥ 3.5 min of install steps + unbounded drain, §3). Lot 2 removes
the *infinite* term (never-LIVE) and runs in parallel from day one — its
ordering second reflects dependency-free parallelism, not lesser value: a
fast builder that still fails silently meets nothing (§1.1.4). Every ETA
is a calendar date in America/Toronto, assuming the named lanes work in
parallel as noted; a missed ETA is reported with its cause, and no ETA is
met by narrowing a lot's exit gate. Today is 2026-11-11; work starts
2026-11-12.

| Lot | Value toward < 60 s | Owner lane(s) | Depends on | ETA (Montréal) |
| --- | --- | --- | --- | --- |
| **L1** Sealed archive cache + prewarm + transfer v2 (§7.1, §7.2) | Removes forge 21 s + source 41 s + tarballs 110 s + recipe 30 s + drain > 999 s from every user run; user path keeps only a ≤ 0.2 s lookup | builder-api | — (contracts frozen by this spec §7.1.3) | **Fri 2026-11-20** |
| **L2** Dispatch reliability (§7.5.1–7.5.4) | `LIVE` becomes reachable at all; no silent failure; restart-safe | artifacts-package + builder-api; immo-host wires its scanner | — (parallel to L1) | **Wed 2026-11-18** |
| **L3** Warm pod pool (§7.3) | S1 pod term 4–6 s → 0.5 s; makes the Warm joint budget structural | builder-api + k8s-platform (quota §7.3.4) | L1 (archive extract), k8s quota change | **Fri 2026-11-27** |
| **L4** Incremental Vite + sealed prebundle (§7.4) | S2 re-projection → ≤ 1.8 s; cold prebundle leaves the user path | builder-api | L1 (archive machinery for the prebundle unit) | **Tue 2026-12-01** |
| **L5** Edge async contract (§7.5.5) | No 502-masked success; truthful accept/poll for write+commit | artifacts-package + k8s-platform (timeout records) | L2 (awaited settle + receipts surface) | **Wed 2026-11-25** |
| **L6** Metrics, SLO endpoints, alerts (§7.6) | SLOs become provable daily, not per-incident | builder-api; k8s-platform wires alert delivery; immo-host consumes in its dashboard lot | L1+L2 emit events from their first change (sink lands first inside each lot) | **Mon 2026-11-23** |
| **L7** Acceptance campaign support + prod gate (§10) | Proves S1–S6 per consumer §7, preprod then prod | conductor (immo) drives; builder-api + k8s-platform on fault injections | L1–L6 | **Tue 2026-12-08** preprod report; **Fri 2026-12-11** prod gate |

Host-side counterparts outside this repository (consumer §8.1 L7/L8 —
prewarm trigger wiring in immo CI, conductor dashboard) depend only on the
§7.1.3 and §7.6.3 contracts, which are frozen by this document at L1/L6
start; they are tracked there, with the same dates as their consumer lot
counterparts above.

### L1 — Sealed archive cache, prewarm API, transfer v2

Deliverables: `requireSealed`/`seal` split and caller migration
(`cache.ts`, `prepare-live.ts`, `build-only.ts`, `idle.ts`); sealed-unit
production + consumption (`supervisor-install.ts` minus drain,
`bootstrap-deps.ts` + new seal section, `bootstrap-materialize.ts`,
`cache-storage.ts` new key shapes); pipelined channel + bounded ustar
reader (`supervisor-channel.ts`, `supervisor-transfer.ts`, new bootstrap
archive section); source unit (`forge-lease.ts`); tarball store + parallel
prefetch (`cache.ts`, `npm-relay.ts`); cache state machine + `CacheJobs`
+ endpoints (new `cache-api.ts` beside `host-build-api.ts`, mounted in
`service.ts`/`builder-mount` path); prewarm budget constants, user-path
ceiling removal (`deadline.ts`); phase-event sink write-through in
`runPhase`/`runInstallStep` (the §7.6.1 foundation, so L1 is measurable
from its first preprod run).

Tests (existing suites: `api/tests/unit/artifacts-live/`):
`cache.test.ts` (miss under `requireSealed` → typed `cache_not_prewarmed`
≤ budget, no fetch attempted — spy on `ports.fetch`; seal → sealed hit
round-trip through archive; tampered archive → quarantine);
`cache-storage.test.ts` (new key shapes accepted, others refused pre-S3);
`bootstrap-deps.test.ts` (seal produces manifest rows equal to today's
drain output on the fixture tree; archive determinism: two seals, same
sha256); new `archive-transfer.test.ts` (ustar reader refuses links,
absolute paths, ratio bombs; pipelined sender preserves commit-digest
refusal under frame reordering); new `prewarm-api.test.ts` (closed-body
refusals, `lock_mismatch`, idempotent join, state transitions
`absent→building→sealed|failed`, yielding admission never blocks a user
heavy phase > one phase); `deadline.test.ts` (5 s lookup bound; prewarm
15 min ceiling names its step); invariants §5.1/§5.2 re-pinned (offline
recipe unchanged, SRI failure seals nothing).

Exit gates: **L1-G (measured, preprod)**: one scripted seal of the immo
lockfile records `tar.zst` archive bytes, seal total ≤ 180 s, concurrent
materialize-into-cold-pod (`/dependencies` + `/workspace`) ≤ 4.8 s p95 /
≤ 7.5 s max, sustained transfer ≥ 25 MB/s (§7.2.1 fallback `F-T1` triggers
otherwise); one user-path run on the sealed lockfile with **zero** install
steps in phase events; one `live start` and one `git_publish` on an unsealed
lockfile each rejected `cache_not_prewarmed` ≤ 5 s with a log line and the
live draft returned to `DORMANT`. Gate output is attached to the lot's
completion record — numbers from phase events, not from wall clock.

### L2 — Dispatch reliability

Deliverables: package — awaited+logged settle, exports, `listWorkerPending`
(+ adapter implementations), `createLiveRedriveScanner`, terminal-state
fields, repeated-start-joins, total stop, `lastCommand` on `live_status`
(§7.5.1–7.5.3, §7.5.5 data source); builder — dispatch refusal logging in
`refusal()`, idempotent bridge stop (`controller.ts`/`bridge.ts`), driver
registry + three scanner passes (`scheduler.ts`, `controller.ts`),
adoption pass + readiness + `drain()` (`product-builder.ts`); hosts —
scanner wiring in Sentropic composition and (immo lane) in
`radar-immo-mcp` composition.

Tests: package (`packages/artifacts/tests/`): new `live-worker.test.ts`
(failure → exactly one structured log with typed code + error propagated
unchanged; success → no failure log; grep gate for bare `catch {`);
`live-service` tests (start during `REVIVING` joins and re-settles; stop
on never-dispatched record → settles `DORMANT`; terminal dispatch failure
after 5 attempts releases the binding). Builder
(`api/tests/unit/artifacts-live/`): `controller.test.ts` (REVIVING + active
pod + no driver → resumed, then terminal after bound), `scheduler` tests
(build-job resume with persisted token; prewarm stale-heartbeat resume),
`host-live-api.test.ts` (stop unknown session at exact generation → 204),
restart simulation test: kill the composition mid-`prepareLive` in the
fixture harness, reboot, assert terminal LIVE or typed failure and a
single session.

Exit gates: the four preprod records stuck `REVIVING`/`QUIESCING` since
2026-11-08/11 reach a terminal state through the scanners alone (no DB
edit) after deploy; a staged failing dispatch in preprod produces both the
package log line and the builder refusal line under one invocation id.

### L3 — Warm pod pool

Deliverables: identity split (§7.3.2 file list §10.3) as its own first
commit series; `KubernetesCore.list/patchLabels` (`pods.ts`,
`kubernetes.ts`); pool manager + claim/scrub (new `pool.ts`, agent
`claim`/`scrub` sections in `bootstrap-agent.ts` composition,
`transitions.ts` release branch, `prepare-live.ts` warm-hit skips);
`POST /v1/pool/drain` + `GET /v1/pool`; `MAX_BUILDER_PODS` 2 → 4 behind
the k8s quota change (§7.3.4, k8s lane delivers the overlay change;
builder reads the value from existing per-environment config).

Tests: `pods.test.ts` (claim descriptor vs session-created parity; label
patch fencing by uid; `recipes.ts` `liveViteConfig` accepts
`artifact-pool-<16-hex>` and rejects malformed names); new `pool.test.ts`
(fill → warm → `renew` keeps 30 min liveness lease alive → claim CAS race:
second claim falls to cold; `poolEpoch` monotonicity lets generation `1` claim
after generation `5` scrub while rejecting replayed epoch frames; `stop`
marks `warm-deps` synchronously so immediate `claimForBuild` hits; scrub
failure deletes pod; cross-scope claim cannot match; adoption after restart
reconciles list vs rows both ways); `races.test.ts` additions (claim vs
teardown interleave never double-binds a fence); `controller.test.ts`
(warm-hit prepare skips install/prepare steps and still fences head movement).

Exit gates: **L3-G (measured, preprod)**: warm-hit S1 sub-steps match
§8.2 warm column; pool minimum holds ≥ 1 for the immo hot key over 24 h
including one API restart; drain endpoint produces a verifiable
cold-known next run.

### L4 — Incremental Vite preview + sealed prebundle

Deliverables: `applyOverlay` agent op + module-transform ACK
(`bootstrap-server.ts`/procs sections), fast path in `project.ts` with
path classification, `builtRevision` through the bridge ACKs
(`bridge.ts`, `worker-client.ts`, `live-worker.ts`), prebundle unit in
the prewarm job (§7.4.3).

Tests: `project` coverage in `controller.test.ts`/new
`fast-projection.test.ts` (source-only write keeps phase `LIVE`, route
never revoked — asserted on route calls; config-path write takes full
path; transform error → typed `vite_transform_failed`, `appliedRevision`
frozen); `bootstrap-server.test.ts` (ETag hash changes exactly when served
content changes); prebundle seal/extract round-trip in
`bootstrap-deps.test.ts` family.

Exit gates: **L4-G (measured, preprod)**: raw prebundle duration on the
immo tree recorded; S2 scripted one-file write ≤ 1.8 s p95 internal budget
over 20 runs on a warm session.

### L5 — Edge async contract

Deliverables: package accept-then-poll for `live_write`/`git_commit`
(§7.5.5), client timeout alignment (`worker-client.ts`), server-side 25 s
rule enforced by budget wrappers on the package execute path; k8s lane
records gateway timeouts per route and sets the > 60 s backstop.

Tests: package tests with a slow fake worker/forge (write returns
acceptance inside budget, outcome lands in `live_status.lastCommand`;
commit retry with same idempotency key joins, one commit total); builder
`host-live-api.test.ts` (no route exceeds its server budget under a hung
fake controller — `ready:false`, never a hang).

Exit gate: consumer F4 replay (pre-fix timeout conditions, coordinated):
zero 502s, every outcome typed or pollable.

### L6 — Metrics, SLO endpoints, alerts

Deliverables: `PhaseEventSink` store + day index (new `phase-events.ts`),
`/v1/metrics/phases`, `/v1/slo`, `/v1/pool` reads, breach-emission
scheduler pass (§7.6.3 rules), retention integration (§7.1.5 pass).

Tests: new `phase-events.test.ts` (nearest-rank p95 at N=20 → 19th value;
< 20 → `insufficientSamples`; joint-verdict arithmetic on fabricated
invocations; sink failure counted + logged, operation outcome unchanged);
`deadline.test.ts` (every `runPhase` outcome emits exactly one event).

Exit gate: `/v1/slo` on preprod reproduces, from stored events alone, the
durations of a scripted MCP run within the 2 s client/builder tolerance.

### L7 — Acceptance campaign support and prod gate

Builder-side deliverables are support only: fault-injection cooperation
(pod kill / API restart windows named in §10), the drain control (L3),
cache-state and SLO reads (L1/L6), and a runbook note in
`api/src/services/artifacts/live/README.md` recording the SLO surfaces.
The campaign itself, its report and the prod go/no-go are the conductor's
(consumer §7); §10 maps every consumer scenario to the builder surface
that proves it.

---

## 10. Acceptance mapping, impact map

### 10.1 Consumer scenario → builder proof surface

The acceptance artifact is the consumer §7.1 small artifact on the current
immo `main` lockfile; every timed step runs through MCP only (consumer
§7 preamble). Builder-side proof for each scenario:

| Consumer scenario | Builder surface that proves it |
| --- | --- |
| §7.1 Warm ×20 (S1–S6) | Precondition: `GET /v1/cache` shows `sealed` for the run `lockSha256`; `GET /v1/pool` warm ≥ 1. Numbers: `GET /v1/slo?case=warm` p50/p95/max + `s6Joint` verdicts; raw rows via `GET /v1/metrics/phases`. Zero install steps in any run's events (asserted on `step` values). |
| §7.2 Cold-known ×20 (S1c, S6) | Per-run cold proof: `POST /v1/pool/drain` answer (pre-drain occupancy across `warm \| warm-deps \| filling`, timestamp) + `GET /v1/pool` = 0 unbound pods + cache state `sealed`; S1 events stamped `case: cold-known` server-side (§7.6.2) — a run whose S1 the builder stamped `warm` is discarded per consumer rules. |
| §7.3 Cold lockfile | Start and static publish without prewarm → `cache_not_prewarmed` ≤ 5 s in both the MCP answer and phase events, live draft stays `DORMANT`; `POST /v1/cache/prewarm` → state poll reaches `sealed` (< 180 s target, < 15 min hard); one smoke S6 run < 60 s. |
| §7.4 F1 dead pod mid-start | k8s pod delete (k8s lane, name/uid recorded); terminal LIVE/typed within 45 s + 60 s from phase events; re-drive count ≥ 1 in `/v1/slo`. |
| §7.4 F2 API restart mid-start | Rollout restart (k8s lane); same terminal guarantee; single session id across the restart in events. |
| §7.4 F3 pod death mid-session | Crash-restore or typed terminal; `stop` afterwards settles; orphan counter returns to 0 ≤ 10 min. |
| §7.4 F4 edge pressure | L5 exit gate replay; zero untyped 5xx in host + builder logs for the campaign window. |
| §7.5 reporting | `/v1/slo` + `/v1/metrics/phases` exports are the report's number source; any `source-gap` phase blocks acceptance (consumer rule) — the phase-event completeness counter (§7.6.3) is printed in the report. |

Known Cold-known measurement gate risk (§8.2): Cold-known S1 (11.8 s p95 /
19.0 s max vs 15 s / 20 s joint line) depends on `unverified` preprod pod
bootstrap and `tar.zst` extraction timings. Because §7.2 drains all pool pods
before every run, pool sizing cannot shorten §7.2; if gates L1-G/L3-G/L4-G
exceed the §8.2 Cold-known sub-budgets, the pre-decided engineering levers
execute in order before L7: (1) raise pipelined frame window `8 → 16`,
(2) activate fallback `F-T1` (presigned single-object S3 GET directly into the
pod during the pre-claim offline phase, §11), and (3) tune seal-time `zstd`
compression level. Separately, for production burst concurrency (consumer Q3),
raising `ARTIFACT_POOL_MIN_PER_HOT_KEY` `1 → 2` (within the 4-slot quota) is
available as an operational configuration knob, never as an SLO edit.

### 10.2 Verification gates per repository change

Each lot lands as atomic commits on its own branch in a `tmp/<slug>`
worktree per this repository's process, with `make scope-check` before
every commit and the touched suites green (`api/tests/unit/artifacts-live/`
for builder lots, `packages/artifacts/tests/` for package lots, plus the
repo typecheck gate). Tests run on `ENV=test-*`/`ENV=e2e-*`, never
`ENV=dev`. Lot completion requires its §9 exit gate — unit green alone
does not close a lot with a measured gate.

### 10.3 Impact map (files a lot may touch; everything else is out of scope)

Traced from the symbols each lot changes (`cache.acquire` callers,
`podName(key)` consumers, settle/dispatch call sites, route mounts):

- **Cache/seal (L1)**: `api/src/services/artifacts/live/{cache,cache-storage,deadline,supervisor-install,supervisor,supervisor-channel,supervisor-transfer,bootstrap-deps,bootstrap-materialize,bootstrap-frame,forge-lease,npm-relay,prepare-live,build-only,host-live-api,host-build-api,idle,service,product-builder}.ts`, new `cache-api.ts` + `phase-events.ts` (sink), route mount `api/src/routes/artifacts-builder.ts` (mount only), tests `api/tests/unit/artifacts-live/{cache,cache-storage,bootstrap-deps,deadline,host-live-api}.test.ts` + new `prewarm-api.test.ts`, `archive-transfer.test.ts`.
- **Dispatch (L2)**: `packages/artifacts/src/server/{live-worker,live-service,live-mutations,live-commit,live-store,live-contracts,live-errors}.ts`, `packages/artifacts/src/live-host/{worker-client,reconcile}.ts`, package adapters implementing `listWorkerPending` (`packages/artifacts/src/adapters/postgres-live.ts` and the sqlite live store), `packages/artifacts/package.json` (one export subpath), `api/src/services/artifacts/live/{controller,scheduler,bridge,host-live-api,host-live-body,host-build-api,product-builder,build-jobs}.ts`, tests on both sides (§9 L2). Host compositions outside the live tree change only to start the scanner, pass a logger, and avoid live reconcile on attach-only static builds.
- **Pool (L3)**: `api/src/services/artifacts/live/{pods,recipes,kubernetes,revive,build-only,heavy,controller,remote-drafts,remote-live,forge-binding,transitions,prepare-live,bootstrap-agent,bootstrap-frame,bootstrap-server,service,product-builder}.ts`, new `pool.ts`, deploy overlay quota values (k8s lane), tests §9 L3.
- **Vite (L4)**: `api/src/services/artifacts/live/{project,bootstrap-server,bootstrap-procs,recipes,worker,supervisor,bridge}.ts`, `packages/artifacts/src/live-host/worker-client.ts`, `packages/artifacts/src/server/{live-worker,live-contracts}.ts`.
- **Edge (L5)**: `packages/artifacts/src/server/{live-service,live-commit,live-read}.ts` (status shape), `packages/artifacts/src/live-host/worker-client.ts`, `deploy/k8s/overlays/{preprod,prod}/ingress.yaml` (timeout records, k8s lane).
- **Metrics (L6)**: `api/src/services/artifacts/live/{phase-events,deadline,service}.ts`, new `slo-api.ts` (or folds into `cache-api.ts` mount), scheduler breach pass in `scheduler.ts`.
- **No database schema change**: all new durable state (cache state, pool
  rows, phase events) uses `control.artifact_host_kv` namespaces following
  `heavy.ts:139` and `cache-storage.ts:131-136`; `spec/DATA_MODEL.md` needs
  no update, and every KV row stays inside its scope-checked namespace
  keyed by the authenticated storage scope (§5.4) — the workspace/scope
  filter check for new queries is: scope always from `hostGate` identity
  or from the `LiveKey`, never from request input.
- **Versioning**: package changes (L2, L4 ACK field, L5 status field) are
  additive and ship as one minor release per lot; builder and host tolerate
  mixed versions for one release (unknown ACK fields ignored, exactly the
  bounded-parse discipline at `worker-client.ts:72-79`).

---

## 11. Risks, decided fallbacks, rollback

| Risk / unknown | Handling in this design |
| --- | --- |
| Pipelined relay still < 25 MB/s (relay service CPU, base64 cost) | L1-G decides with preprod numbers. Fallback **F-T1**: the pod fetches the one sealed archive directly from the cache bucket with a presigned, single-object, ≤ 120 s GET URL delivered in a signed supervisor frame, usable only in the offline pre-claim/pre-install phase; requires a NetworkPolicy egress exception to the S3 endpoint only + security-lane (s-archi) review. Sealed-unit format and all host contracts unchanged. `[DECISION]` taken in advance so L1 never blocks on it. |
| Archive sizes larger than budgeted (`unverified`, §7.1.2) | Budgets are formulas over measured bytes at L1-G; if concurrent extract > 4.8 s p95 / 7.5 s max, first lever is frame window 8 → 16, second is F-T1, third is `zstd` compression level tuning at seal time (cost paid out of band). |
| Prebundle duration unknown | L4-G measures before promising; sealed prebundle degrades to re-optimize on mismatch (correctness never depends on it). |
| Pool scrub leaves residue (credentials in `/tmp`, zombie processes) | Scrub ACK must prove cleared set + empty process tree; any doubt deletes the pod (§5.5). A dedicated negative test plants files/processes and asserts deletion-not-reuse. Pool pods are scope-partitioned and age-capped at 24 h. |
| Heavy queue: prewarm/fill starve a user build | Yielding admission (§7.1.3) bounds the block to one heavy phase; queue wait is a phase event and alerts at the same thresholds as user phases. Heavy budget arithmetic itself is untouched (`product-builder.ts:35-37`). |
| Mixed package/builder versions during rollout | Additive fields + dual-read (archive-absent fallback one release, §7.1.2; row-key dual-read one release, §7.3.2). Rollout order: builder first (new endpoints are additive), package second, hosts last; preprod before prod everywhere (consumer §1.3). |
| `cache_not_prewarmed` surprises users after a host trigger miss | That is the intended visible failure: typed in ≤ 5 s, alerted on first occurrence (§7.6.3), sealed by a conductor manual prewarm; strictly better than today's 20–45 min hang, and the consumer's chosen default (§2 Q1). |
| Rollback | Each lot rolls back independently: L1 by re-enabling per-file materialize fallback + `acquire` miss path (kept one release); L3 by pool minimum 0 (claim path unreached); L4 by disabling fast projection (full re-projection remains); L2/L5 are behaviour-preserving strengthenings with no rollback need identified — reverting them reintroduces a known severity-1 defect and requires the owner's explicit call. |

Deferred alternatives, recorded so they are not re-litigated per lot:
OCI image per `cacheKey` (needs registry push + image build infrastructure;
the receipt's `archive` seam keeps it open), in-place pod resource resize
for warm pods (Kubernetes feature maturity; quota raise is sufficient),
a queueing answer for un-prewarmed starts (§2 Q1).

---

## Appendix A — Error-code registry (additions; §2 Q6)

Existing codes (`builder_unavailable`, `git_live_conflict`, `stale_session`,
`pending_publication`, `phase_timeout:<phase>[:<step>]`,
`dependency_cache_invalid`, `provider_unavailable`, …) are unchanged. New
codes are added to this appendix **before** they appear in code constants
(builder: `records.ts`; package: `live-errors.ts`). HTTP mapping is at the
builder host boundary; package mapping preserves the code string to MCP.

| Code | HTTP | Retriable | Meaning / emitted by |
| --- | --- | --- | --- |
| `cache_not_prewarmed` | 409 | yes (after seal) | No sealed unit for the `lockSha256` (detail carries it + `cacheState`). `requireSealed`, §7.1.4 |
| `lock_mismatch` | 422 | no | Prewarm `lockSha256` ≠ lockfile at `commitSha/subPath`. §7.1.3 |
| `sealed_unit_invalid` | 500→typed | yes (after re-seal) | Archive digest/tree mismatch at materialize; entry quarantined. §7.1.2 |
| `pool_exhausted` | 503 | yes | No warm pod and no pod slot inside the start budget. §7.3.3 |
| `builder_draining` | 503 | yes | Builder draining for deploy; retry reaches the new replica. §7.5.4 |
| `builder_restarted` | — (job state) | yes | Prewarm/build interrupted by restart; auto-retried by scanner. §7.5.2 |
| `dispatch_failed:<last code>` | — (status `stateDetail`) | terminal | Retry budget exhausted; binding released. §7.5.2 |
| `vite_transform_failed` | 200-accept/typed status | yes (next write) | Fast-projection module transform error; revision not applied. §7.4.1 |
| `phase_timeout:seal:<step>` | — (job state) | yes | Prewarm cut by its own budget. §7.1.6 |

## Appendix B — Evidence index (origin/main `7a352bb4d`)

| Claim in §3–§4 | Source |
| --- | --- |
| Sealed manifest, HMAC, atomic admit exist | `api/src/services/artifacts/live/cache.ts:41-53,83-98`; `cache-storage.ts:146-178` |
| Miss installs inline on user paths | `cache.ts:100-162`; callers `prepare-live.ts:42`, `build-only.ts:163`, `idle.ts:46` |
| Per-file materialize (S3 GET + rehash each) | `cache.ts:166-179`; `supervisor.ts:79-89`; `bootstrap-materialize.ts:64-83` |
| Five serial install transfers; drain per file | `supervisor-install.ts:35-99`; `cache.ts:140-146`; `forge-lease.ts:126-133` |
| Frames 768 KiB base64, awaited serially; ≈ 3.4 MB/s | `supervisor-transfer.ts:11,54-69`; `supervisor-channel.ts:81-93`; `deadline.ts:21-23` |
| Install ceiling 20 min default, env override | `deadline.ts:13,28,40-44,120-123` |
| Pods: 2 slots, 1536 Mi, deterministic fused name, 3 mounts | `service.ts:36`; `product-builder.ts:35-41`; `pods.ts:8-16,54,73-85,175-198`; `recipes.ts:96`; `remote-drafts.ts:41-95`; `remote-live.ts:28-29`; `forge-binding.ts:95` |
| Pod liveness lease (30 min) and lifetime monotonic fence | `bootstrap-frame.ts:14,22-25,54-60,90-95`; `bootstrap-server.ts:121-123` |
| Write re-projects + revokes route | `project.ts:19-42`; `recipes.ts:67-90` |
| Fire-and-forget + swallowed catch + unexported settle + null-runtime reconcile | `live-service.ts:156-167`; `live-commit.ts:110`; `live-worker.ts:42`; `worker-client.ts:88-155`; `build-only.ts:25-55`; `host-build-api.ts:54-70`; package exports (no `./server/live-worker`) |
| Repeated start refused; stop preconditions | `live-mutations.ts:19-22,52`; `live-service.ts:51-54,70-74` |
| Scheduler leaves driverless REVIVING alone | `controller.ts:61-70`; `scheduler.ts:15-43`; `product-builder.ts:33,123,136-140` |
| Build runs fire-and-forget; 90 min stale window | `host-build-api.ts:68`; `build-jobs.ts:13-14,37-39` |
| 202+poll and 25 s ready:false patterns exist | `host-build-api.ts:54-76`; `host-live-api.ts:47-56`; `product-builder.ts:41` |
| Metrics = hashed-key log lines only | `deadline.ts:124-131,189-227`; `controller.ts:142` |
| Heavy queue already re-seeds after restart | `heavy.ts:33-41,104-107` |
| Tenant ingress has no timeout annotations | `deploy/k8s/overlays/preprod/ingress.yaml` (whole file) |
| `feat/artifact-builder-pool-d2-4` = placement/sizing only | branch diff (`eef59470e`) vs its base: `pods.ts` + `pods.test.ts` only; superseded by `pods.ts:59-60,77-78` on `origin/main` |

*End of specification.*
